# Forge WASM package

Read `/AGENTS.md` and `/scripts/AGENTS.md` for packaging workflows.

`yarn build:forge-wasm-package --stub-engine` followed by `yarn verify:forge-wasm-package` checks packing, consumer types, and Vite bundling only; never publish a stub build.

Ordinary engines accept opt-in `decisionJournal: true` and emit `forge:journal` through `onEvent`. This is the game-thread consumed-input stream. It contains hidden information. Preserve the shared JVM/native/WASM contract documented in the harness AGENTS file; older WASM artifacts may ignore the option, so consumers must require the initial manifest before treating journaling as active.
