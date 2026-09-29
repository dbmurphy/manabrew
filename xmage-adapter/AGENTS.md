# XMage protocol research

This Java subprocess probes `manabrew-protocol` against an unmodified XMage server. Build against the pinned release client libraries, not Forge. Downloaded runtimes and logs belong in untracked scratch storage; do not vendor them.

- `prompt` carries canonical `AgentPrompt`, `state` carries canonical `StateUpdate`, and `respond` takes `ClientToServerMessage::Response`. Session RPC and callback evidence are adapter tooling.
- `protocolGap` means the schema requires unavailable information or semantics; `adapterGap` means an implementation omission. Never confuse them or infer intent/legality from card names.
- Experimental `ChooseObject` is incremental. Candidate selection does not certify that an aggregate declaration is legal. The engine validates Finish. Native GAME_TARGET min/max are not aggregate target bounds.
- Preserve `Unknown` targeting intent, manual payment capabilities, and state coverage metadata. Do not silently replace unavailable semantics with Forge defaults.
- Non-cancellable multi-amount allocation uses bounded numeric subprompts; preserve feasibility of the remaining total and submit only the completed vector.
- Playable-ability field introspection and `SerializedSession` are pinned-release dependencies. The latter serializes the stock callback handler to avoid its add/copy/clear race; do not remove it without repeated live transport verification.
- Smoke scenarios and compressed live captures are described in README.md. The smoke uses loopback only. All current scenarios must finish and exhibit their intended mechanics. The original activated-ability failure remains a historical fixture; current code exposes that bucket as Unclassified.
- The standalone research browser uses a loopback HTTP bridge and real prompt components. Keep its per-seat privacy, origin checks, prompt-ID validation and bounded waits intact. Normal app/relay transport, public-server compatibility, reconnect, rich state fidelity, Forge AI and Spellbench interoperability remain unimplemented.
- Preserve native picker order and only auto-answer a saved ability ID if offered. Modal choices share the same native callback. Normalize native HTML for presentation, never for inference about rules.
