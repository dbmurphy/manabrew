# Forge WASM package

Read `/AGENTS.md` and `/scripts/AGENTS.md` for packaging workflows.

`replay.js` is an experimental opt-in facade shared by the browser and Node factories. The app still uses the ordinary engine. Every external seat response must be journaled through the facade; do not expose raw seat buffers or directives that can bypass it. Internal Forge AI is unsupported because equal seeds did not reliably reproduce its decisions in the investigation.

Seed replay uses a separate worker and adopts it only after the recorded input prefix and target boundary match. Preserve the original worker on candidate failure, and issue fresh public prompt IDs on adoption. The fingerprint covers the deciding seat's visible game view and prompt, not all hidden engine state. A passing fixture is not a universal determinism guarantee.

Forge `GameSnapshot` was not a safe intermediate replay anchor in the audit: turn counters and per-player land-history fields retained future values after both full-phase and sparse restores. Do not replace seed replay with snapshot-plus-replay without auditing the entire restore state first.

Run `yarn bench:forge-replay` with real engine artifacts for behavioral coverage. `yarn build:forge-wasm-package --stub-engine` followed by `yarn verify:forge-wasm-package` checks packing, consumer types, and Vite bundling only; never publish a stub build.

The replay facade owns incoming protocol objects and clones only at consumer callback boundaries. Keep each callback isolated from the journal and other callbacks. The integration probe deliberately mutates callback messages and caller-owned actions to check this. Candidate-only eager polling must switch back on adoption and stop on disposal; preserve the ordinary engine scheduler.

`yarn bench:forge-replay-profile` compares snapshots, disabled snapshots, and replay with matched seeded actions/final state. Run performance cases serially, without competing engine probes; use `--restore` separately for browser and multi-mechanic correctness. Animation-frame polling can hide CPU savings in browser wall time.

A compiled-module sharing experiment did not materially reduce Firefox rewind time in the measured fixture. Instantiation fell from about 1.1 seconds to 74 ms, but each fresh worker still spent about 5 seconds unpacking 36,609 asset files and 8–9 seconds initializing Forge. The experiment is not enabled: measure initialization stages before assuming compilation is the dominant cost.
