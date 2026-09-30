# @manabrew/forge-wasm

Forge compiled to WebAssembly with GraalVM Web Image. The package runs Forge on a worker and exposes its state, display and prompt messages on the main thread.

It runs in a browser and on Node. The entry point differs, the API does not. It includes the Forge launcher and the WebAssembly engine, with Forge's whole asset tree — every card script, token script and edition — embedded inside the engine module at build time. Boot unpacks it into the engine's in-memory filesystem with no JavaScript boundary crossing, and the lazy card index Forge builds from it is complete, so any card can come up in a game.

## Install

Pin an exact version while the API is pre-1.0:

```sh
npm install --save-exact @manabrew/forge-wasm@0.3.0
```

## Browser: server headers

In a browser, Forge uses `SharedArrayBuffer` and requires a cross-origin isolated page. Serve the application with these response headers:

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

`createForgeEngine()` rejects if `crossOriginIsolated` is false.

## Browser: Vite setup

The package's Vite plugin keeps the large engine module out of dependency pre-bundling and emits it as a static asset:

```js
// vite.config.js
import { forgeWasm } from "@manabrew/forge-wasm/vite";

export default {
  plugins: [forgeWasm()],
};
```

## Node

`import` resolves to a Node entry through the package's `node` condition, with the same API. There is no bundler and no cross-origin isolation to arrange: Node has `SharedArrayBuffer` unconditionally, and the engine runs on a `worker_threads` worker that reads its files from disk.

```js
import { createForgeEngine } from "@manabrew/forge-wasm";

const engine = await createForgeEngine({ onState, onPrompt });
await engine.startGame({ deck, opponentDecks: [deck] });
```

Node 20 or later. Call `dispose()` when the game ends, or the worker thread keeps the process alive.

## Usage

```js
import { createForgeEngine } from "@manabrew/forge-wasm";

const engine = await createForgeEngine({
  onState(state) {
    render(state);
  },
  onPrompt(prompt) {
    showPrompt(prompt, (action) => engine.respond(prompt.id, action));
  },
  onDisplay(event) {
    showEvent(event);
  },
  onError(error) {
    console.error(error);
  },
});

await engine.startGame({
  deck: humanDeck,
  opponentDecks: [computerDeck],
});
```

A deck has `cards` plus optional `commanders`, `sideboard`, `attractions`, `contraptions`, `schemes`, `planes` and `companion`. Each entry can carry its printing under `identity` and is repeated according to `count`:

```js
const deck = {
  format: "commander",
  commanders: [{ identity: { name: "Najeela, the Blade-Blossom" }, count: 1 }],
  cards: [{ identity: { name: "Lightning Bolt", setCode: "M11", cardNumber: "149" }, count: 1 }],
};
```

Pass whole decks, not just the maindeck. Every zone above is read when the game is set up, so a commander or companion left out never reaches the table it belongs to.

Call `dispose()` to terminate the worker. A running Forge game is synchronous inside the worker, so terminating the worker is the only immediate cancellation mechanism.

`directive()` sends an out-of-band instruction such as a concession or a restore request. Each seat has its own directive lane, apart from its prompt buffer, and the engine reads every lane while it waits on any prompt, so a directive lands at once, even while another seat is deciding.

## Experimental isolated replay

`createReplayForgeEngine()` is an opt-in alternative for games whose human and bot responses all pass through JavaScript. It disables Forge snapshots, records protocol answers, and rewinds by replaying from the original seed in a second worker. The ordinary `createForgeEngine()` API and Manabrew app restore flow are unchanged.

```js
import { createReplayForgeEngine } from "@manabrew/forge-wasm";

const engine = await createReplayForgeEngine({
  onState: (state, slot) => renderSeat(state, slot),
  onPrompt: (prompt, slot) =>
    chooseForSeat(prompt, slot, (action) => engine.respond(prompt.promptId, action, slot)),
  onRestorePoints: (points) => showRewindChoices(points),
  onRestored: () => resetExternalBots(),
  onReplayUnavailable: (reason) => disableRewind(reason),
  onError: (error) => console.error(error),
});
await engine.startGame({ deck, opponentDecks: [deck], seed: 42 });

// When paused at an empty-stack priority prompt:
await engine.restoreTo(selectedPointId, { timeoutMs: 30_000, signal: abortSignal });
```

The factory creates a lazy facade; the first start boots the worker. One facade runs one game. `startMultiplayerGame()` uses the same slot routing as the ordinary engine. Every seat must answer through `respond()`, including external Manabot seats. Internal Forge AI is rejected: a seed alone has not reproduced its choices reliably. Direct SharedArrayBuffer bot clients, directives, concessions, restore voting, and app/relay integration are not provided by this facade. `dispose()` ends the session.

The facade retains up to 32 empty-stack priority boundaries, at most one per turn/step/active player combination. These are input boundaries, so phases without a priority prompt have no point. `getRestorePoints()` returns their IDs and labels. Restore is allowed only while the live engine has one pending empty-stack priority prompt. Responses and concurrent restores are rejected during candidate validation. On success, future history is dropped and the target prompt gets a fresh public ID; late responses carrying an old ID are rejected. Reset external bot state and discard cached prompts in `onRestored` before responding to the replacement prompt.

Every replayed answer and the target boundary must match the original seat, prompt, and deciding seat's visible `gameView` fingerprint. Prompt IDs and outer state timing/checkpoint metadata are excluded. Cancellation, timeout, mismatch, and candidate failure discard the second worker and preserve the original pending prompt. This check detects observed divergence; it does **not** prove equality of hidden engine state or determinism for every card. Keep the engine, launcher, worker, and card assets pinned for the session. Browser runtime coverage and broad card coverage are still required before adopting this experimental API in the app.

Normal play pays for cloning callback data, hashing prompt state, and retaining answers instead of full Java snapshots. The isolated candidate consumes seat messages through asynchronous atomic wakeups (with a timer fallback), then returns to normal animation-frame polling when adopted. With a matching WASM build, it generates only the deciding seat’s view during the replay prefix, resumes full broadcasts before the target, and suppresses replay timing telemetry. Older artifacts remain compatible but do not skip the unused views. Restore pays for a second engine boot and replay from the beginning, so its latency grows with game history and temporarily requires two workers. This is not a sparse native-checkpoint implementation. `maxJournalBytes` defaults to 8 MiB and bounds estimated serialized journal size, not total JavaScript or WASM heap use. Exceeding it disables rewind and releases history while allowing play to continue. `getReplayStatus()` reports availability, recorded inputs, estimated bytes, and whether a restore is running.

The repository's real WASM integration probe exercises replay, regenerated branches, continuation, timeout, cancellation, mismatch, worker failure, stale responses, and journal exhaustion:

```sh
yarn bench:forge-replay --launcher /path/to/forgeharness.js
yarn bench:forge-replay --launcher /path/to/forgeharness.js --seats 4 --seed 43
yarn bench:forge-replay --launcher /path/to/forgeharness.js \
  --manabot-js /path/to/wasm.js --manabot-wasm /path/to/wasm_bg.wasm
```

The matching `forgeharness.js.wasm` must sit beside the launcher. These probes use real engine assets; package verification with `--stub-engine` separately checks packing, types, and bundling.

## Replay profiling

`yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js` compares ordinary snapshots, snapshots disabled, and the replay facade over identical seeded decisions. It rotates their order across three runs, checks matching actions and final visible state, and emits JSON with the WASM SHA-256, runtime version, startup time, forward-play wall/CPU time, snapshot cost/count, and estimated journal size. Only the opening dice acknowledgements are sorted for comparison because their seat delivery order can vary.

Forward time starts at the first priority prompt and ends at the selected turn's first main phase; startup is reported separately. Node CPU covers the process and its workers. Chrome CPU covers the isolated test browser's processes via CDP; each case uses a fresh page so earlier worker lifetimes do not distort later readings. Firefox CPU is not measured. `--restore` retains a validation transcript and checks timeout, cancellation, adoption, stale prompt rejection, and the complete continuation; use runs without this option for the forward-play performance comparison.

```sh
yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js --runs 3 --turns 10
yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js --browser chrome
yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js \
  --browser firefox --mode replay --runs 1 --turns 5 --restore
yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js \
  --fixture scry --mode replay --runs 1 --turns 10 --restore
```

Browser probes use Playwright, installed Chrome or Playwright's Firefox, and a local server with the required isolation headers. `--timer-fallback` disables `Atomics.waitAsync` in that test page to exercise candidate polling on runtimes without it. These are headless runtime probes, not app UI tests. Use `--seats 4` for multiplayer and `--fixture token|combat|scry|bounce|extra` for token creation, attacking/blocking, scry, creature bounce, or extra turns. The latter four assert that their intended mechanic actually occurred. These small synthetic decks are reproducible comparisons, not representative Commander performance estimates.

Capture a four-seat Commander policy once with real Manabot, then compare the same decisions across modes (bot thinking is excluded from the subsequent measurements):

```bash
yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js \
  --record-trace /tmp/commander-trace.json --seed 43 --turns 20 \
  --manabot-js /path/to/wasm.js --manabot-wasm /path/to/wasm_bg.wasm
yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js \
  --trace /tmp/commander-trace.json --runs 3
yarn bench:forge-replay-profile --launcher /path/to/forgeharness.js \
  --trace /tmp/commander-trace.json --mode replay --runs 1 --restore
```

The default presets are Kaalia, Animar, Teval, and Neheb; `--presets` accepts comma-separated filenames from `public/preset_decks` without `.json`. The trace includes their deck lists, seed, visible prompt frames, and answers, so retain the trace with the measurements. Capture currently runs in Node. Cross-mode trace comparison normalizes only the temporary `casting-<abilityId>` display entry to its source card: snapshot copying consumes ability allocation IDs, even when the game is otherwise identical. Actual stack target IDs and all other fields must match. Production replay fingerprints and restored suffix checks remain strict.

Use `bench:forge-replay --seats 4 --local-seat 2 --bot-seats 1,3` to check mixed-seat cache restoration as well as the ordinary all-human multiplayer probe.

## Types

Messages are typed by [`@manabrew/protocol`](https://www.npmjs.com/package/@manabrew/protocol), which the package depends on: `onState` hands you a `StateUpdate`, `onPrompt` a `Prompt`, `onDisplay` a `DisplayEvent`, and `respond` takes a `PromptOutput`. The range tracks the protocol's major version, which is the wire compatibility boundary.

`ForgeDeck` is looser than the protocol's `Deck`, so a deck can be built from card names alone. A `Deck` satisfies it, so one fetched from a relay can be passed straight to `startGame`.

## Multiplayer seats

`startMultiplayerGame()` creates one SharedArrayBuffer-backed seat per player. Messages for the browser's local seat have no `playerSlot`; remote messages carry `player-0`, `player-1` and so on. Pass that slot back to `respond()` after relaying a remote player's answer.

```js
const engine = await createForgeEngine({
  onMessage(message, playerSlot) {
    if (playerSlot) relayToPlayer(playerSlot, message);
  },
});

await engine.startMultiplayerGame({
  decks,
  playerNames,
  enginePlayerIndex: 0,
});

engine.respond(promptId, action, "player-1");
```

## Asset overrides

The launcher, worker and engine WASM URLs can all be overridden. Their defaults are module-relative URLs that Vite and other modern bundlers emit as static assets. On Node they default to the installed files, and an override may be a path or a `file:` URL.

## Which build is this

The package exports two strings, stamped in when it is built:

```js
import { VERSION, BUILD_COMMIT } from "@manabrew/forge-wasm";
```

`BUILD_COMMIT` names the tree. Quote both in a bug report.

## Subpath exports

One internal is exported because Manabrew's own client imports it rather than keeping a second copy:

- `@manabrew/forge-wasm/seat` — the SharedArrayBuffer seat protocol: `createSeat`, `pollSeat`, `writeSeatMessage`, `deliverSeatDirective` and the signal constants.

## Licence

`@manabrew/forge-wasm` is distributed under the GNU Affero General Public License version 3 or later. Forge itself is GPL-3.0 licensed. Corresponding source is available in the Manabrew repository and its pinned `forge` submodule.
