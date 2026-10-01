import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseArgs } from "node:util";
import { createForgeEngine } from "../../packages/forge-wasm/node.js";
import { resolve } from "node:path";
import { decks, scriptedAnswer } from "./replay-fixture.mjs";

const { values } = parseArgs({
  options: {
    jar: { type: "string" },
    launcher: { type: "string" },
    "forge-home": { type: "string" },
    java: { type: "string", default: "java" },
    decisions: { type: "string", default: "80" },
  },
});
assert(values.jar && values["forge-home"], "--jar and --forge-home are required");
const decisions = Number(values.decisions);
assert(Number.isSafeInteger(decisions) && decisions > 0);
const sessionId = "decision-journal-probe";
const request = {
  gameId: sessionId,
  variant: "Constructed",
  startingLife: 20,
  seed: 43,
  snapshotRecording: false,
  decisionJournal: true,
  players: [0, 1].map((seat) => ({
    name: `Player ${seat}`,
    ai: false,
    bot: seat === 1,
    deck: decks.token.cards.flatMap(({ name, count }) =>
      Array.from({ length: count }, () => ({ name })),
    ),
  })),
};
const pause = () => new Promise((resolve) => setTimeout(resolve, 5));

function harness() {
  const child = spawn(
    values.java,
    [
      "-Xmx1g",
      "-cp",
      values.jar,
      "forge.harness.Main",
      "--interactive-server",
      "--forge-home",
      values["forge-home"],
    ],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let pending,
    stderr = "";
  child.stderr.on("data", (bytes) => {
    stderr = (stderr + bytes).slice(-8192);
  });
  const lines = createInterface({ input: child.stdout });
  lines.on("line", (line) => {
    if (!pending) return;
    let response;
    try {
      response = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof response.ok !== "boolean") return;
    const current = pending;
    pending = null;
    clearTimeout(current.timer);
    if (response.ok) current.resolve(response.result);
    else current.reject(new Error(response.error));
  });
  child.on("error", (error) => pending?.reject(error));
  child.on("exit", (code) => pending?.reject(new Error(`harness exited ${code}: ${stderr}`)));
  return {
    call(command, extra = {}) {
      assert(!pending, "serialize harness calls");
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`timeout in ${command}: ${stderr}`)),
          60_000,
        );
        pending = { resolve, reject, timer };
        child.stdin.write(JSON.stringify({ command, sessionId, ...extra }) + "\n");
      });
    },
    async prompt(after) {
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        const raw = await this.call("getPrompt", { playerIndex: 0 });
        if (raw) {
          const prompt = JSON.parse(raw);
          if (prompt.promptId !== after) return prompt;
        }
        await this.call("getGameOver");
        await pause();
      }
      throw new Error("next prompt did not arrive");
    },
    async consumed() {
      const deadline = performance.now() + 10_000;
      while (performance.now() < deadline) {
        const batch = await this.drain();
        if (batch) return batch;
        await pause();
      }
      throw new Error("consumed decision did not arrive");
    },
    async drain() {
      const raw = await this.call("drainDecisionJournal");
      return raw ? JSON.parse(raw) : null;
    },
    close() {
      if (pending) clearTimeout(pending.timer);
      child.kill("SIGKILL");
      lines.close();
    },
  };
}

async function views(engine) {
  const result = [];
  for (const viewer of [0, 1])
    result.push(JSON.parse(await engine.call("getSnapshot", { viewer })));
  return result;
}

const entries = [];
let startRequest, terminalPrompt, terminalViews;
const source = harness();
try {
  await source.call("startGame", { payload: JSON.stringify(request) });
  let prompt = await source.prompt();
  const first = await source.drain();
  assert.equal(first.version, 1);
  startRequest = first.startRequest;
  assert.deepEqual(JSON.parse(startRequest), request);
  assert.deepEqual(first.entries, []);
  assert.equal(await source.drain(), null);
  for (let index = 0; index < decisions; index++) {
    if (index === 3) {
      const action = {
        type: "directive",
        player: -1,
        directive: { type: "setSnapshotRecording", enabled: false },
      };
      await source.call("submitAction", { payload: JSON.stringify(action) });
      const batch = await source.consumed();
      assert.equal(batch.entries.length, 1);
      assert.deepEqual(batch.entries[0].action, action);
      assert.deepEqual(batch.entries[0].prompt, prompt);
      assert.equal(batch.entries[0].sequence, entries.length + 1);
      entries.push(batch.entries[0]);
    }
    const action = scriptedAnswer({ prompt });
    await source.call("submitAction", { payload: JSON.stringify(action) });
    const next = await source.prompt(prompt.promptId);
    const batch = await source.drain();
    assert.equal(batch.unavailableReason, undefined);
    assert.equal(batch.startRequest, undefined);
    assert.equal(batch.entries.length, 1);
    assert.equal(batch.nextSequence, entries.length + 2);
    const entry = batch.entries[0];
    assert.equal(entry.sequence, entries.length + 1);
    assert.deepEqual(entry.prompt, prompt);
    assert.deepEqual(entry.action, action);
    assert.equal(entry.playerIndex, Number(prompt.decidingPlayerId?.split("-")[1] ?? -1));
    entries.push(entry);
    prompt = next;
  }
  terminalPrompt = prompt;
  terminalViews = await views(source);
  await source.call("submitAction", {
    payload: JSON.stringify({
      type: "directive",
      player: 0,
      directive: { type: "requestRestore", checkpointId: 999999 },
    }),
  });
  assert.match((await source.consumed()).unavailableReason, /snapshot restore/);
} finally {
  source.close();
}

const shadow = harness();
try {
  await shadow.call("startGame", { payload: startRequest });
  let prompt = await shadow.prompt();
  await shadow.drain();
  for (const entry of entries) {
    assert.deepEqual(prompt, entry.prompt, `divergence before decision ${entry.sequence}`);
    await shadow.call("submitAction", { payload: JSON.stringify(entry.action) });
    if (entry.action.type !== "directive") prompt = await shadow.prompt(prompt.promptId);
    const batch = await shadow.consumed();
    assert.deepEqual(batch.entries, [entry]);
  }
  assert.deepEqual(prompt, terminalPrompt);
  assert.deepEqual(await views(shadow), terminalViews);

  const action = scriptedAnswer({ prompt });
  action.padding = "x".repeat(8 * 1024 * 1024);
  await shadow.call("submitAction", { payload: JSON.stringify(action) });
  prompt = await shadow.prompt(prompt.promptId);
  const overflow = await shadow.drain();
  assert.match(overflow.unavailableReason, /limit/);
  assert.deepEqual(overflow.entries, []);
  assert.equal(await shadow.drain(), null);
  await shadow.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
  await shadow.prompt(prompt.promptId);
  assert.equal(await shadow.drain(), null);
} finally {
  shadow.close();
}

const disabled = harness();
try {
  const aiRequest = structuredClone(request);
  aiRequest.players[1].ai = true;
  await assert.rejects(
    disabled.call("startGame", { payload: JSON.stringify(aiRequest) }),
    /external decisions/,
  );
  await assert.rejects(
    disabled.call("startGame", {
      payload: JSON.stringify({ ...request, checkpoint: "{}" }),
    }),
    /external decisions/,
  );
  await disabled.call("startGame", {
    payload: JSON.stringify({ ...request, decisionJournal: false }),
  });
  const prompt = await disabled.prompt();
  await disabled.call("submitAction", { payload: JSON.stringify(scriptedAnswer({ prompt })) });
  await disabled.prompt(prompt.promptId);
  assert.equal(await disabled.drain(), null);
} finally {
  disabled.close();
}

let wasm;
if (values.launcher) {
  const queue = [],
    recorded = [],
    sent = new Map();
  let wake, failure, manifest;
  const engine = await createForgeEngine({
    launcherUrl: resolve(values.launcher),
    wasmUrl: resolve(`${values.launcher}.wasm`),
    onPrompt: (prompt, slot) => {
      queue.push({ prompt, slot });
      wake?.();
    },
    onError: (error) => {
      failure = error;
      wake?.();
    },
    onEvent: (event, batch) => {
      if (event !== "forge:journal") return;
      try {
        assert.equal(batch.version, 1);
        assert.equal(batch.unavailableReason, undefined);
        if (batch.startRequest) {
          assert.equal(manifest, undefined);
          manifest = JSON.parse(batch.startRequest);
        }
        for (const entry of batch.entries) {
          assert.equal(entry.sequence, recorded.length + 1);
          assert.deepEqual(entry.action, sent.get(entry.prompt.promptId));
          recorded.push(entry);
        }
        assert.equal(batch.nextSequence, recorded.length + 1);
      } catch (error) {
        failure = error;
        wake?.();
      }
    },
  });
  try {
    await engine.startGame({
      deck: decks.token,
      opponentDecks: [decks.token],
      seed: 43,
      gameId: sessionId,
      snapshotRecording: false,
      decisionJournal: true,
    });
    while (recorded.length < decisions) {
      if (!queue.length && !failure) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("WASM prompt timeout")), 30_000);
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
        });
      }
      if (failure) throw failure;
      if (recorded.length >= decisions) break;
      const frame = queue.shift();
      if (!frame) continue;
      const action = scriptedAnswer(frame);
      sent.set(frame.prompt.promptId, action);
      engine.respond(frame.prompt.promptId, action, frame.slot);
    }
    assert.equal(manifest.seed, 43);
    assert.equal(manifest.gameId, sessionId);
    wasm = { consumedDecisions: recorded.length, transport: "forge:journal", matched: true };
  } finally {
    engine.dispose();
  }
}

console.log(
  JSON.stringify(
    {
      runtime: "JVM",
      decisions: entries.length,
      jarSha256: createHash("sha256")
        .update(await readFile(values.jar))
        .digest("hex"),
      replay: "matched prompts, consumed actions, and both terminal seat views",
      overflow: "explicit invalidation; game continued",
      rejected: ["internal AI", "checkpoint start"],
      disabled: "no journal batches",
      wasm,
    },
    null,
    2,
  ),
);
