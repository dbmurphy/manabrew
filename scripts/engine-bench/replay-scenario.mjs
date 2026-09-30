import { decks, scriptedAnswer } from "./replay-fixture.mjs";

export function comparable(frame, normalizeCasting = false) {
  const {
    gameId: _gameId,
    checkpoints: _checkpoints,
    snapshotRecording: _snapshotRecording,
    ...view
  } = frame.state.gameView;
  if (normalizeCasting)
    view.stack = view.stack.map((entry) =>
      entry.isCasting && entry.id.startsWith("casting-")
        ? { ...entry, id: `casting:${entry.sourceId}` }
        : entry,
    );
  return JSON.stringify({ slot: frame.slot, prompt: { ...frame.prompt, promptId: 0 }, view });
}

export async function replayScenario(
  createEngine,
  {
    mode,
    seed = 42,
    seats = 2,
    turns = 10,
    restore = false,
    measureCpu,
    fixture = "token",
    gameDecks,
    decide = scriptedAnswer,
    trace,
  },
) {
  const deck = decks[fixture];
  if (!deck && !gameDecks) throw new Error(`Unknown fixture ${fixture}`);
  const promptTypes = {};
  let attackers = 0,
    blockers = 0,
    extraTurnSeen = false;
  const states = new Map(),
    queue = [],
    history = [],
    actions = [];
  let waiter, failure, engine;
  const started = performance.now();
  let firstPrompt,
    forwardStart,
    restorePoint,
    restored = false,
    copies = 0,
    checkpointMs = 0,
    forwardCpu;
  const frame = () => {
    if (failure) return Promise.reject(failure);
    if (queue.length) return Promise.resolve(queue.shift());
    return new Promise((resolve, reject) => {
      waiter = { resolve, reject };
    });
  };
  engine = await createEngine({
    onState: (state, slot) => states.set(slot, state),
    onPrompt: (prompt, slot) => {
      firstPrompt ??= performance.now();
      const value = { prompt, slot, state: states.get(slot) };
      if (waiter) {
        waiter.resolve(value);
        waiter = null;
      } else queue.push(value);
    },
    onError: (error) => {
      failure = error;
      waiter?.reject(error);
      waiter = null;
    },
    onEvent: (event, payload) => {
      if (event === "forge:checkpoints") {
        copies += payload.length;
        for (const timing of payload) checkpointMs += (timing[0] + timing[1]) / 1e6;
      }
      if (event === "game:forced_end" || event === "game:over") {
        failure = new Error(`Unexpected ${event}`);
        waiter?.reject(failure);
      }
    },
  });
  try {
    const snapshotRecording = mode === "snapshots";
    await engine.startMultiplayerGame({
      decks: gameDecks ?? Array(seats).fill(deck),
      playerNames: Array.from({ length: seats }, (_, i) => `Seat ${i}`),
      enginePlayerIndex: 0,
      seed,
      startingLife: 100,
      ...(mode === "replay" ? {} : { snapshotRecording }),
    });
    let current;
    for (;;) {
      current = await frame();
      const view = current.state.gameView;
      if (current.prompt.input.type === "chooseAction" && forwardStart === undefined) {
        forwardCpu = await measureCpu?.();
        forwardStart = performance.now();
      }
      if (
        restore &&
        !restorePoint &&
        view.turn === Math.max(2, turns - 2) &&
        view.step === "main1" &&
        view.stack.length === 0 &&
        current.prompt.input.type === "chooseAction"
      ) {
        restorePoint = { ...engine.getRestorePoints().at(-1), index: history.length };
      }
      if (
        view.turn >= turns &&
        view.step === "main1" &&
        view.stack.length === 0 &&
        current.prompt.input.type === "chooseAction"
      )
        break;
      if (actions.length >= 10000) throw new Error("Scenario exceeded input limit");
      const expected =
        current.prompt.input.type === "diceRolled"
          ? trace?.history.find((entry) => {
              const frame = JSON.parse(entry.frame);
              return frame.slot === current.slot && frame.prompt.input.type === "diceRolled";
            })
          : trace?.history[actions.length];
      const expectedFrame = expected ? JSON.parse(expected.frame) : null;
      if (
        trace &&
        (!expected ||
          comparable(current, true) !==
            comparable(
              {
                ...expectedFrame,
                state: { gameView: expectedFrame.view },
              },
              true,
            ))
      )
        throw new Error(`Recorded frame diverged at input ${actions.length}`);
      const action = expected ? expected.action : decide(current, { combat: fixture === "combat" });
      const type = current.prompt.input.type;
      promptTypes[type] = (promptTypes[type] ?? 0) + 1;
      if (type === "chooseAttackers") attackers += action.output.assignments.length;
      if (type === "chooseBlockers") blockers += action.output.assignments.length;
      extraTurnSeen ||= view.players.some((player) => player.isExtraTurn);
      actions.push(JSON.stringify({ slot: current.slot, action }));
      if (restore) history.push({ comparable: comparable(current), action });
      engine.respond(current.prompt.promptId, action, current.slot);
    }
    if (fixture === "scry" && !promptTypes.scry) throw new Error("Fixture did not scry");
    if (fixture === "bounce" && !promptTypes.chooseBoardTargets)
      throw new Error("Fixture did not target a creature");
    if (fixture === "combat" && (!attackers || !blockers))
      throw new Error("Fixture did not attack and block");
    if (fixture === "extra" && !extraTurnSeen)
      throw new Error("Fixture did not take an extra turn");
    const forwardMs = performance.now() - forwardStart;
    const cpu = await measureCpu?.();
    const forwardCpuMs = cpu
      ? (cpu.user + cpu.system - forwardCpu.user - forwardCpu.system) / 1000
      : null;
    const finalState = comparable(current);
    if (trace && (actions.length !== trace.history.length || finalState !== trace.finalState))
      throw new Error("Recorded final state diverged");
    const journalBytes = engine.getReplayStatus?.().journalBytes ?? 0;
    let restoreMs = null;
    if (restore) {
      if (!restorePoint) throw new Error("No restore point");
      const oldPrompt = current.prompt.promptId;
      const rejected = async (operation, pattern) => {
        try {
          await operation;
        } catch (error) {
          if (pattern.test(String(error))) return;
          throw error;
        }
        throw new Error("Expected restore rejection");
      };
      await rejected(engine.restoreTo(restorePoint.id, { timeoutMs: 1 }), /timed out/);
      const controller = new AbortController();
      const pending = engine.restoreTo(restorePoint.id, { signal: controller.signal });
      controller.abort(new Error("cancelled during boot"));
      await rejected(pending, /cancelled during boot/);
      if (queue.length) throw new Error("Failed candidate leaked a prompt");
      const at = performance.now();
      await engine.restoreTo(restorePoint.id, { timeoutMs: 120000 });
      restoreMs = performance.now() - at;
      current = await frame();
      if (current.prompt.promptId <= oldPrompt) throw new Error("Stale adopted prompt ID");
      await rejected(
        Promise.resolve().then(() =>
          engine.respond(oldPrompt, scriptedAnswer(current), current.slot),
        ),
        /Stale/,
      );
      for (let i = restorePoint.index; i < history.length; i++) {
        if (comparable(current) !== history[i].comparable)
          throw new Error(`Suffix diverged at ${i}`);
        engine.respond(current.prompt.promptId, history[i].action, current.slot);
        current = await frame();
      }
      if (comparable(current) !== finalState) throw new Error("Final state diverged");
      restored = true;
    }
    if (mode !== "snapshots" && copies !== 0) throw new Error("Unexpected snapshot copies");
    return {
      mode,
      fixture,
      seed,
      seats,
      turns,
      promptTypes,
      attackers,
      blockers,
      extraTurnSeen,
      inputs: actions.length,
      bootMs: firstPrompt - started,
      forwardMs,
      forwardCpuMs,
      restoreMs,
      restored,
      copies,
      checkpointMs,
      journalBytes,
      actions,
      finalState,
    };
  } finally {
    engine.dispose();
  }
}
