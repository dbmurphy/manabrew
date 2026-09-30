const LOCAL = "local";
const TRANSPORT_EVENTS = new Set([
  "game:sab",
  "game:remote_sab",
  "game:directive_lanes",
  "game:seat_state",
]);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])]),
    );
  }
  return value;
}

async function fingerprint(prompt, state) {
  const { promptId: _promptId, ...input } = prompt;
  const bytes = new TextEncoder().encode(
    JSON.stringify(canonical({ prompt: input, gameView: state.gameView })),
  );
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class ReplayForgeEngine {
  constructor(Engine, options = {}) {
    this.Engine = Engine;
    this.options = options;
    this.maxJournalBytes = options.maxJournalBytes ?? 8 * 1024 * 1024;
    if (!Number.isSafeInteger(this.maxJournalBytes) || this.maxJournalBytes < 1) {
      throw new Error("maxJournalBytes must be a positive integer.");
    }
    this.journal = [];
    this.journalBytes = 0;
    this.points = [];
    this.nextPointId = 1;
    this.nextPromptId = 1;
    this.active = null;
    this.restore = null;
    this.request = null;
    this.disabledReason = null;
    this.disposed = false;
  }

  notify(name, ...args) {
    if (this.disposed) return;
    try {
      this.options[name]?.(...args);
    } catch (error) {
      if (name !== "onError") this.options.onError?.(error);
    }
  }

  emit(message, slot) {
    const playerSlot = slot === LOCAL ? undefined : slot;
    if (this.options.onMessage) this.notify("onMessage", structuredClone(message), playerSlot);
    const field = { state: "state", prompt: "prompt", display: "event", error: "error" }[
      message.kind
    ];
    const callback = {
      state: "onState",
      prompt: "onPrompt",
      display: "onDisplay",
      error: "onError",
    }[message.kind];
    if (this.options[callback]) this.notify(callback, structuredClone(message[field]), playerSlot);
  }

  createContext() {
    const context = { states: new Map(), waiting: new Map(), queue: [], wake: null, failure: null };
    context.engine = new this.Engine({
      eagerPolling: () => context !== this.active,
      workerUrl: this.options.workerUrl,
      launcherUrl: this.options.launcherUrl,
      wasmUrl: this.options.wasmUrl,
      onMessage: (message, playerSlot) => this.receive(context, message, playerSlot ?? LOCAL),
      onError: (error, playerSlot) => this.failContext(context, error, playerSlot),
      onEvent: (event, payload) => {
        if (event === "game:over" && context === this.active)
          this.disableReplay("The game has ended.");
        else if (event === "game:forced_end" || event === "game:over") {
          this.failContext(context, new Error("Forge ended before replay could continue."));
        }
        if (context === this.active && !TRANSPORT_EVENTS.has(event))
          this.notify("onEvent", event, payload);
      },
    });
    return context;
  }

  failContext(context, error, playerSlot) {
    if (context === this.active && !(error instanceof Error)) {
      this.disableReplay("Forge rejected an input; this journal cannot be replayed.");
      this.restore?.cancel(new Error("Forge rejected an input."));
      this.emit({ kind: "error", error }, playerSlot ?? LOCAL);
      return;
    }
    context.failure = error instanceof Error ? error : new Error(JSON.stringify(error));
    context.wake?.();
    if (context === this.active) {
      this.disableReplay(context.failure.message);
      this.restore?.cancel(context.failure);
      this.notify("onError", context.failure, playerSlot);
    }
  }

  disableReplay(reason) {
    if (this.disabledReason) return;
    this.disabledReason = reason;
    this.journal = [];
    this.journalBytes = 0;
    this.points = [];
    this.notify("onReplayUnavailable", reason);
    this.notify("onRestorePoints", []);
  }

  receive(context, message, slot) {
    if (this.disposed || context.failure) return;
    if (message.kind === "state") context.states.set(slot, message.state);
    if (message.kind === "error") return;
    if (message.kind === "prompt") {
      const state = context.states.get(slot);
      if (!state) {
        this.failContext(context, new Error("Forge supplied a prompt without a seat state."));
        return;
      }
      const frame = {
        slot,
        prompt: message.prompt,
        state,
        digest: this.disabledReason ? Promise.resolve(null) : fingerprint(message.prompt, state),
      };
      frame.digest.catch((error) => this.failContext(context, error));
      context.waiting.set(slot, frame);
      if (context === this.active) this.publishPrompt(frame);
      else {
        context.queue.push(frame);
        context.wake?.();
      }
      return;
    }
    if (context === this.active) this.emit(message, slot);
  }

  publishPrompt(frame, makePoint = true) {
    frame.publicId = this.nextPromptId++;
    const view = frame.state.gameView;
    if (
      makePoint &&
      !this.disabledReason &&
      frame.prompt.input.type === "chooseAction" &&
      view.stack.length === 0
    ) {
      const previous = this.points.at(-1);
      if (
        !previous ||
        previous.turn !== view.turn ||
        previous.step !== view.step ||
        previous.activePlayerId !== view.activePlayerId
      ) {
        this.points.push({
          id: this.nextPointId++,
          index: this.journal.length,
          bytes: this.journalBytes,
          turn: view.turn,
          step: view.step,
          activePlayerId: view.activePlayerId,
          slot: frame.slot,
          inputType: frame.prompt.input.type,
          digest: frame.digest,
        });
        if (this.points.length > 32) this.points.shift();
        this.notify("onRestorePoints", this.getRestorePoints());
      }
    }
    this.emit(
      { kind: "prompt", prompt: { ...frame.prompt, promptId: frame.publicId } },
      frame.slot,
    );
  }

  async start(method, args) {
    if (this.disposed || this.request) throw new Error("A replay engine can start only one game.");
    if (args.forgeAi || args.forgeAiSeats?.length)
      throw new Error(
        "Replay requires externally journaled bot decisions; internal Forge AI is unsupported.",
      );
    if (args.snapshotRecording === true)
      throw new Error(
        "Replay replaces full snapshots; snapshotRecording must be false or omitted.",
      );
    const seed =
      args.seed ?? (globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % 2147483646) + 1;
    if (!Number.isSafeInteger(seed) || seed <= 0 || seed >= 2147483647)
      throw new Error("Replay seed must be an integer between 1 and 2147483646.");
    this.method = method;
    this.request = structuredClone({
      ...args,
      seed,
      gameId: globalThis.crypto.randomUUID(),
      snapshotRecording: false,
    });
    const context = this.createContext();
    this.active = context;
    try {
      return await context.engine[method](structuredClone(this.request));
    } catch (error) {
      this.failContext(context, error);
      context.engine.dispose();
      throw error;
    }
  }

  startGame(args) {
    return this.start("startGame", args);
  }
  startMultiplayerGame(args) {
    return this.start("startMultiplayerGame", args);
  }

  respond(promptId, action, playerSlot) {
    if (this.disposed) throw new Error("Replay engine is disposed.");
    if (this.restore) throw new Error("Responses are paused while a restore candidate is checked.");
    const slot = playerSlot ?? LOCAL;
    const frame = this.active?.waiting.get(slot);
    if (!frame || frame.publicId !== promptId) throw new Error("Stale or unknown Forge prompt.");
    const recorded = structuredClone(action);
    const bytes = new TextEncoder().encode(JSON.stringify(recorded)).length + 128;
    this.active.engine.respond(frame.prompt.promptId, recorded, slot);
    this.active.waiting.delete(slot);
    if (!this.disabledReason) {
      if (this.journalBytes + bytes > this.maxJournalBytes)
        this.disableReplay("Replay journal exceeded maxJournalBytes; the game can continue.");
      else {
        this.journal.push({
          slot,
          inputType: frame.prompt.input.type,
          digest: frame.digest,
          action: recorded,
        });
        this.journalBytes += bytes;
      }
    }
  }

  getRestorePoints() {
    return this.points.map(({ id, turn, step, activePlayerId }) => ({
      id,
      turn,
      step,
      activePlayerId,
    }));
  }

  getReplayStatus() {
    return {
      available: !this.disposed && !this.disabledReason,
      reason: this.disabledReason,
      recordedInputs: this.journal.length,
      journalBytes: this.journalBytes,
      restoring: this.restore !== null,
    };
  }

  async nextFrame(context, expected) {
    for (;;) {
      if (context.failure) throw context.failure;
      let index = 0;
      if (expected.inputType === "diceRolled") {
        index = context.queue.findIndex((frame) => frame.slot === expected.slot);
        if (index < 0 && context.queue.some((frame) => frame.prompt.input.type !== "diceRolled"))
          throw new Error("Replay prompt order differs.");
      }
      if (index >= 0 && context.queue.length > index) return context.queue.splice(index, 1)[0];
      await new Promise((resolve) => {
        context.wake = resolve;
      });
      context.wake = null;
    }
  }

  async restoreTo(id, { signal, timeoutMs = 30000 } = {}) {
    if (this.disposed || this.disabledReason)
      throw new Error(this.disabledReason ?? "Replay engine is disposed.");
    if (this.restore) throw new Error("A restore is already in progress.");
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("timeoutMs must be positive.");
    const point = this.points.find((entry) => entry.id === id);
    if (!point) throw new Error("Restore point is no longer available.");
    const original = this.active;
    const waiting = [...original.waiting.values()];
    if (
      waiting.length !== 1 ||
      waiting[0].prompt.input.type !== "chooseAction" ||
      waiting[0].state.gameView.stack.length !== 0
    )
      throw new Error("Restore requires a paused, empty-stack priority prompt.");
    if (signal?.aborted) throw signal.reason ?? new Error("Restore cancelled.");
    const candidate = this.createContext();
    let rejectCancelled;
    const cancelled = new Promise((_, reject) => {
      rejectCancelled = reject;
    });
    const cancel = (error) => {
      candidate.failure = error instanceof Error ? error : new Error(String(error));
      candidate.wake?.();
      candidate.engine.dispose();
      rejectCancelled(candidate.failure);
    };
    this.restore = { candidate, cancel };
    const onAbort = () => cancel(signal.reason ?? new Error("Restore cancelled."));
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => cancel(new Error("Restore candidate timed out.")), timeoutMs);
    let adopted = false;
    try {
      const prepare = async () => {
        await candidate.engine[this.method](structuredClone(this.request));
        for (const expected of [...this.journal.slice(0, point.index), point]) {
          const frame = await this.nextFrame(candidate, expected);
          if (frame.slot !== expected.slot || (await frame.digest) !== (await expected.digest))
            throw new Error("Restore candidate diverged; the original game was preserved.");
          if (candidate.failure) throw candidate.failure;
          if (!expected.action) return frame;
          candidate.engine.respond(frame.prompt.promptId, expected.action, frame.slot);
          candidate.waiting.delete(frame.slot);
        }
      };
      const frame = await Promise.race([prepare(), cancelled]);
      if (this.disposed || this.active !== original || candidate.failure)
        throw new Error("Restore candidate was superseded.");
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      this.active = candidate;
      this.journal = this.journal.slice(0, point.index);
      this.journalBytes = point.bytes;
      this.points = this.points.filter((entry) => entry.id <= id);
      original.engine.dispose();
      adopted = true;
      this.restore = null;
      this.notify("onRestored", this.getRestorePoints().at(-1));
      for (const [slot, state] of candidate.states) this.emit({ kind: "state", state }, slot);
      this.notify("onRestorePoints", this.getRestorePoints());
      this.publishPrompt(frame, false);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (!adopted) {
        candidate.failure ??= new Error("Restore candidate discarded.");
        candidate.wake?.();
        candidate.engine.dispose();
      }
      if (this.restore?.candidate === candidate) this.restore = null;
    }
  }

  dispose() {
    this.disposed = true;
    this.restore?.cancel(new Error("Replay engine disposed."));
    this.active?.engine.dispose();
    this.active = null;
    this.restore = null;
    this.request = null;
    this.journalBytes = 0;
    this.journal = [];
    this.points = [];
  }
}
