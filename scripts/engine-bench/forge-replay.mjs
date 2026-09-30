#!/usr/bin/env node
import assert from "node:assert/strict";
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
const deck = {
  format: "standard",
  cards: [
    { name: "Forest", count: 20 },
    { name: "Memnite", count: 20 },
    { name: "Sprout", count: 20 },
  ],
};
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
        enginePlayerIndex: 0,
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
  const input = prompt.input;
  let output;
  switch (input.type) {
    case "diceRolled":
      output = { type: "diceRolledAcknowledged" };
      break;
    case "mulligan":
      output = { type: "mulliganDecision", keep: true };
      break;
    case "revealCards":
      output = { type: "revealCardsAcknowledged" };
      break;
    case "payManaCost":
      output = { type: "pay", auto: !input.canConfirmFromPool };
      break;
    case "chooseAction": {
      const action = input.actions.find((entry) => entry.type === "cast");
      output = action ? { type: "act", actionId: action.id } : { type: "pass" };
      break;
    }
    case "chooseAttackers":
      output = { type: "declareAttackers", assignments: [] };
      break;
    case "chooseBlockers":
      output = { type: "declareBlockers", assignments: [] };
      break;
    case "chooseCards":
      output = {
        type: "chooseCardsDecision",
        chosenCardIds: input.cards
          .slice(0, Math.max(input.min, Math.min(1, input.max)))
          .map((card) => card.id),
      };
      break;
    default:
      throw new Error(`Unsupported fixture prompt ${input.type}`);
  }
  return { type: input.type, output };
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
  let point, current;
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
      point = { ...engine.getRestorePoints().at(-1), index: history.length };
    }
    if (
      !current.slot &&
      board.turn >= 5 &&
      board.step === "main1" &&
      current.prompt.input.type === "chooseAction" &&
      board.stack.length === 0
    )
      break;
    assert.ok(history.length < 600);
    const action = answer(current);
    history.push({ frame: current, action });
    engine.respond(current.prompt.promptId, action, current.slot);
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
  assert.equal(run.copies, 0);
  engine.dispose();
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
      inputs: history.length,
      botInputs: history.filter(({ frame }) => frame.slot).length,
      restoreMs,
      forwardSnapshotCopies: run.copies,
      checked: [
        "replay",
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
