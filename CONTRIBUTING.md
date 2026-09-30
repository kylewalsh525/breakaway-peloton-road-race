# Development conventions

Run `npm run verify`, the browser suite, the pure-Java check and the real HTTP/SSE load smoke test before submitting changes. Keep the browser/server runtime dependency-free unless an explicit architecture change is justified. Use named ES-module imports/exports supported by scripts/build.mjs; the static bundler deliberately rejects unsupported syntax.

Gameplay changes belong in shared/simulation.mjs and need deterministic tests, not client-only visual rules. New inputs require schema/sequence/rate validation. Add tests for malformed values, repeated packets and stale telemetry before changing a protocol contract. Bump PROTOCOL for incompatible wire changes and test rejection of old clients.

Native sensor changes must stay read-only and isolated. A successful bind is not live data; a parsed value is not proof of field semantics. Include source attribution, synthetic fixtures and physical results for each adapter claim. Never add physical-resistance control through the game command bridge.

Keep recognition privacy explicit. Native/offline and provider-assisted paths have different guarantees. Tests injecting recognition events exercise command routing, not the acoustic recognizer. Do not record or upload raw audio as incidental diagnostics.

Use original or properly licensed assets. Store human-readable documentation of any new asset/model license. Keep credentials, signing keys, personally identifying traces and result data out of commits. Update the test report with what actually ran, including failed or unexecuted release gates.
