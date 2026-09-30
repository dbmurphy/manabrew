#!/usr/bin/env node
import assert from "node:assert/strict";
import { decks, scriptedAnswer } from "./replay-fixture.mjs";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createReplayForgeEngine } from "../../packages/forge-wasm/node.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const option = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};
const launcher = resolve(option("launcher", join(root, "packages/forge-wasm/forgeharness.js")));
const temporary = mkdtempSync(join(tmpdir(), "forge-replay-"));
const worker = join(temporary, "worker.js");
const delegate = `importScripts(${JSON.stringify(join(root, "packages/forge-wasm/forge-engine.worker.js"))});\n`;
writeFileSync(worker, delegate);
const fixture = option("fixture", "token");
const deck = decks[fixture];
assert.ok(deck, `Unknown fixture ${fixture}`);
const request = {
  deck,
  opponentDecks: [deck],
  seed: Number(option("seed", "42")),
  startingLife: 100,
};
const seats = Number(option("seats", "2"));
assert.ok(Number.isInteger(seats) && seats >= 2 && seats <= 4);
const start = (engine) =>
  seats === 2
    ? engine.startGame(request)
    : engine.startMultiplayerGame({
        decks: Array(seats).fill(deck),
        playerNames: Array.from({ length: seats }, (_, i) => `Seat ${i}`),
        enginePlayerIndex: Number(option("local-seat", "0")),
        botSeats: option("bot-seats", "").split(",").filter(Boolean).map(Number),
        seed: request.seed,
        startingLife: request.startingLife,
      });
const engines = [];
const bots = new Map();
let Manabot;
if (option("manabot-js")) {
  const module = await import(pathToFileURL(resolve(option("manabot-js"))));
  await module.default({ module_or_path: readFileSync(resolve(option("manabot-wasm"))) });
  Manabot = module.WasmManabot;
}
function resetBots() {
  for (const bot of bots.values()) bot.free();
  bots.clear();
}
function answer(frame) {
  const { prompt, slot, state } = frame;
  if (slot && Manabot) {
    if (!bots.has(slot)) bots.set(slot, new Manabot());
    const bot = bots.get(slot);
    bot.observe_frame(JSON.stringify({ kind: "state", state }));
    return JSON.parse(bot.answer_frame(JSON.stringify({ kind: "prompt", prompt }))).action;
  }
  return scriptedAnswer(frame, { combat: fixture === "combat" });
}

async function create(extra = {}) {
  const states = new Map(),
    queue = [];
  let waiter,
    failure,
    prompts = 0,
    copies = 0;
  const engine = await createReplayForgeEngine({
    launcherUrl: launcher,
    wasmUrl: `${launcher}.wasm`,
    workerUrl: worker,
    ...extra,
    onMessage: (message) => {
      if (message.kind === "state") message.state.gameView.turn = -1;
      if (message.kind === "prompt") message.prompt.input.type = "mutated";
    },
    onState: (state, slot) => states.set(slot, state),
    onPrompt: (prompt, slot) => {
      prompts++;
      const frame = { prompt, slot, state: structuredClone(states.get(slot)) };
      if (waiter) {
        waiter.resolve(frame);
        waiter = null;
      } else queue.push(frame);
    },
    onError: (error) => {
      failure = error;
      waiter?.reject(error);
      waiter = null;
    },
    onRestored: () => resetBots(),
    onEvent: (event, payload) => {
      assert.ok(!["game:sab", "game:remote_sab", "game:directive_lanes"].includes(event));
      if (event === "forge:checkpoints") copies += payload.length;
    },
  });
  engines.push(engine);
  return {
    engine,
    views: () =>
      new Map([...states].map(([slot, state]) => [slot, structuredClone(state.gameView)])),
    get prompts() {
      return prompts;
    },
    get copies() {
      return copies;
    },
    frame() {
      if (failure) return Promise.reject(failure);
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        waiter = { resolve, reject };
      });
    },
  };
}
function same(expected, actual) {
  const clean = ({ prompt, state, slot }) => ({
    prompt: { ...prompt, promptId: 0 },
    board: state.gameView,
    slot,
  });
  assert.deepEqual(clean(actual), clean(expected));
}
const deadline = setTimeout(() => {
  console.error("Replay integration probe timed out");
  process.exit(1);
}, 150000);
try {
  const run = await create();
  const engine = run.engine;
  await start(engine);
  const history = [];
  let point,
    current,
    rejectedBusyPoint = false;
  for (;;) {
    current = await run.frame();
    const board = current.state.gameView;
    if (
      !point &&
      board.turn === 3 &&
      board.step === "main2" &&
      current.prompt.input.type === "chooseAction" &&
      board.stack.length === 0
    ) {
      // Other seats consume the same broadcast on independent polling ticks.
      await new Promise((resolve) => setTimeout(resolve, 25));
      point = { ...engine.getRestorePoints().at(-1), index: history.length, views: run.views() };
    }
    if (
      !current.slot &&
      board.turn >= 5 &&
      board.step === "main1" &&
      current.prompt.input.type === "chooseAction" &&
      board.stack.length === 0
    )
      break;
    if (point && !rejectedBusyPoint && current.prompt.input.type !== "chooseAction") {
      await assert.rejects(engine.restoreTo(point.id), /paused, empty-stack/);
      rejectedBusyPoint = true;
    }
    assert.ok(history.length < 600);
    const action = answer(current);
    history.push({ frame: current, action });
    const delivered = structuredClone(action);
    engine.respond(current.prompt.promptId, delivered, current.slot);
    delivered.output.type = "mutated";
  }
  assert.ok(point);
  const original = current;
  const prompts = run.prompts;
  const points = engine.getRestorePoints();
  const restore = (options) => engine.restoreTo(point.id, options);
  const unchanged = () => {
    assert.equal(run.prompts, prompts);
    assert.deepEqual(engine.getRestorePoints(), points);
    assert.equal(engine.getReplayStatus().restoring, false);
  };
  await assert.rejects(
    restore({ signal: AbortSignal.abort(new Error("cancelled before start")) }),
    /cancelled/,
  );
  unchanged();
  await assert.rejects(restore({ timeoutMs: 1 }), /timed out/);
  unchanged();
  const controller = new AbortController();
  const pending = restore({ signal: controller.signal });
  await assert.rejects(restore(), /already in progress/);
  assert.throws(
    () => engine.respond(original.prompt.promptId, answer(original), original.slot),
    /paused/,
  );
  controller.abort(new Error("cancelled during boot"));
  await assert.rejects(pending, /cancelled during boot/);
  unchanged();
  writeFileSync(
    worker,
    `${delegate}const receive = self.onmessage; self.onmessage = (event) => { if (event.data.args?.seed) event.data.args.seed += 1; return receive(event); };\n`,
  );
  await assert.rejects(restore(), /diverged|order differs/);
  unchanged();
  writeFileSync(worker, 'throw new Error("injected worker crash");\n');
  await assert.rejects(restore(), /injected worker crash/);
  unchanged();
  writeFileSync(worker, delegate);
  const started = performance.now();
  await restore();
  const restoreMs = performance.now() - started;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.deepEqual(run.views(), point.views);
  current = await run.frame();
  assert.ok(current.prompt.promptId > original.prompt.promptId);
  assert.throws(
    () => engine.respond(original.prompt.promptId, answer(original), original.slot),
    /Stale/,
  );
  assert.ok(engine.getRestorePoints().every((entry) => entry.id <= point.id));
  for (let i = point.index; i < history.length; i++) {
    same(history[i].frame, current);
    engine.respond(current.prompt.promptId, history[i].action, current.slot);
    current = await run.frame();
  }
  same(original, current);
  const regenerated = engine
    .getRestorePoints()
    .find((entry) => entry.turn === 4 && entry.step === "main2");
  assert.ok(regenerated);
  const regeneratedIndex = history.findIndex(
    ({ frame }) =>
      frame.state.gameView.turn === 4 &&
      frame.state.gameView.step === "main2" &&
      frame.prompt.input.type === "chooseAction" &&
      frame.state.gameView.stack.length === 0,
  );
  await engine.restoreTo(regenerated.id);
  current = await run.frame();
  same(history[regeneratedIndex].frame, current);
  for (let i = 0; i < 20; i++) {
    engine.respond(current.prompt.promptId, answer(current), current.slot);
    current = await run.frame();
  }
  for (
    let i = 0;
    current.prompt.input.type !== "chooseAction" || current.state.gameView.stack.length;
    i++
  ) {
    assert.ok(i < 100);
    engine.respond(current.prompt.promptId, answer(current), current.slot);
    current = await run.frame();
  }
  assert.equal(run.copies, 0);
  const disposing = engine.restoreTo(engine.getRestorePoints().at(-1).id);
  engine.dispose();
  await assert.rejects(disposing, /disposed/);
  const capped = await create({ maxJournalBytes: 1 });
  await start(capped.engine);
  let frame = await capped.frame();
  capped.engine.respond(frame.prompt.promptId, answer(frame), frame.slot);
  assert.equal(capped.engine.getReplayStatus().available, false);
  assert.deepEqual(capped.engine.getRestorePoints(), []);
  frame = await capped.frame();
  capped.engine.respond(frame.prompt.promptId, answer(frame), frame.slot);
  await capped.frame();
  capped.engine.dispose();
  const booting = await create();
  const boot = start(booting.engine);
  booting.engine.dispose();
  await assert.rejects(boot, /disposed/);
  assert.equal(booting.engine.getReplayStatus().journalBytes, 0);
  const unsupported = await create();
  await assert.rejects(
    unsupported.engine.startGame({ ...request, forgeAi: true }),
    /internal Forge AI/,
  );
  unsupported.engine.dispose();
  console.log(
    JSON.stringify({
      result: "matched",
      seats,
      fixture,
      inputs: history.length,
      botInputs: history.filter(({ frame }) => frame.slot).length,
      restoreMs,
      forwardSnapshotCopies: run.copies,
      checked: [
        "replay",
        "all restored seat views",
        "callback mutation isolation",
        "caller action mutation isolation",
        "dispose during replay",
        "dispose during initial boot",
        "regenerated branch",
        "live continuation",
        "cancel",
        "timeout",
        "concurrent restore",
        "mismatch",
        "worker crash",
        "stale response",
        "journal limit",
        "internal AI rejection",
      ],
    }),
  );
} finally {
  clearTimeout(deadline);
  for (const engine of engines) engine.dispose();
  resetBots();
  rmSync(temporary, { recursive: true, force: true });
}
