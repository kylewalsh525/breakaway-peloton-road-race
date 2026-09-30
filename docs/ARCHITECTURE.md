# Architecture

## System boundary

The bike supplies measurements; the game alone decides virtual motion. No layer changes the physical bike's resistance, calibration, update policy, or class entitlements.

```text
Peloton exported sensor service             Browser BLE power meter / FTMS
             |                                            |
Android read-only Binder probes               validated Bluetooth decoders
             |                                            |
     secure local WebView bridge  ---------------- TelemetryMux
             |                                  arrival age / source / stale
             +------------------- Game client ------------+
Microphone -> Vosk / consented provider -> VoiceGate       |
Keyboard / gamepad / touch ---------------- Commands       |
Phone -> one-time pairing -> scoped controller ------------|
                                                          |
               SOLO                            MULTIPLAYER
      shared fixed-step simulation         authenticated HTTP input
               |                                  |
               |                         server room simulation (30 Hz)
               |                                  |
               |                           SSE snapshots (15 Hz)
               |                                  |
               +-------------------- presentation interpolation
                                                  |
                          original Canvas renderer / audio / HUD
```

The shared simulation is used by both solo and the server. Multiplayer clients never choose a timestep, finish time, hit result, leaderboard position, or another rider's state. Every network command is validated on the server. This does not authenticate physical power: a modified client can still invent plausible watts, so all competitive times are explicitly unverified.

## Modules and contracts

`shared/protocol.mjs` owns wire version, limits, accepted actions and telemetry fields. `shared/simulation.mjs` owns fixed-step racing, AI, combat, pickups, standings, and immutable-style presentation snapshots. Inputs enter through `applyInput`; actions use the same server function regardless of keyboard, voice or phone origin. Courses and objects derive from reproducible track seeds.

`shared/telemetry.mjs` is the source-arbitration boundary. It timestamps actual incoming sensor samples, rejects implausible values and duplicate sequences, and returns zero propulsion once a measurement is more than 2.5 seconds old. Re-reading a cached sample does not refresh it. The server independently expires traffic after 2.5 seconds without an accepted measurement. Demonstration power is an explicit selectable source; missing physical measurements never become demonstration data automatically.

`shared/voice.mjs` accepts only a small set of exact phrases. It rejects low confidence, interim results, conversational sentences and negations; tracks utterance identifiers; and debounces repeated commands. Gameplay cooldowns remain separate: passing the voice gate cannot bypass game rules.

The renderer consumes state without owning state. It performs road projection, curve/hill rendering, procedural scenery, cyclist animation, item sprites, and effects. Quality settings cap its internal drawing width at 640, 1080 or 1440 pixels. Canvas output is an original pseudo-3D visual style, not a modern 3D-engine simulation or a claim of Road Rash pixel fidelity. DOM menus/HUD are independent of the drawing surface for responsive controls and focus behavior.

The native shell hosts only packaged content at `https://app.breakaway.local`. Its JavaScript bridge exposes narrowly scoped operations: read sensor data, start/stop explicitly authorized speech, report non-sensitive capabilities, configure a server origin, and export a user-selected file. Arbitrary remote top-level pages, iframes, file URLs and content URLs cannot obtain this bridge. The remote race server is a network destination, not a WebView page.

## Deliberate engineering choices

**Plain JavaScript modules, no web/server runtime packages.** The project can be executed with a stock Node installation and opened as an offline bundle. The restricted build script is deliberately not a general-purpose bundler: it handles the project's named imports and rejects unsupported syntax. Runtime protocol validation and tests are essential because this source is not a TypeScript static-type safety claim.

**HTTP input plus SSE instead of WebSockets/Colyseus.** Racing snapshots are predominantly server-to-client; input packets are small and sparse. Native Node HTTP keeps this delivery dependency-free, supports bearer authorization outside URLs, and works through standard HTTPS infrastructure. The tradeoff is more upstream request overhead and the need to explicitly disable proxy event-stream buffering. The transport is isolated in `client/network.mjs`; substituting WebSockets later does not require rewriting the simulation.

**Server interpolation, not client-authoritative prediction.** The client buffers snapshots and interpolates presentation approximately 95 ms behind receipt. Commands receive immediate visual acknowledgment, but collision outcomes await the authority. There is no rewind-based hit compensation or speculative combat rollback in this version. That avoids client trust and reconciliation complexity but makes voice/provider latency important to real-device acceptance.

**Java native shell rather than Kotlin/Capacitor.** The shell uses a small Android surface, no framework bridge plugin, and a pure-Java sensor mapper that can be tested without an Android runtime. Native voice still depends on Vosk/JNA and the Android build toolchain.

## Lifecycle and recovery

Rooms have a stable race ID independent of render ticks. SSE reconnects restore the same session/rider and return the next accepted input sequence. Reloading an active game therefore does not need to count back through thousands of rejected low-number packets. New races clear interpolation/event state; stable IDs make repeated result presentation idempotent for local XP.

A disconnected stream marks the rider offline. Stale measurements cause coasting; two minutes without a stream mark the rider DNF. A reconnect within that window resumes the original rider. Sessions expire after thirty minutes without authenticated activity. A process restart invalidates ephemeral rooms and bearer sessions; durable race summaries survive. There is no distributed session store or live room migration in this release.

On Android, leaving the activity stops microphone capture and sensor bindings. Returning re-probes requested sensors but does not silently restart the microphone. Binder death, unavailable exported services, malformed frames and silent bindings are surfaced as capability states. Unknown firmware is not guessed from a friendly model name.

## Persistence and scale

Career progress and settings are local. Server results use a single-writer journal, repair torn records at startup, and compact to a bounded recent history. There is no email/password account system. Do not run two server processes against the same journal directory.

Default bounds are 32 rooms, 256 sessions, eight riders per room, and up to sixteen total room members including spectators. These are guards, not proven production capacity. The delivered local load result covers 32 simulated clients in four rooms; real WAN, long-duration and physical-device measurements remain separate acceptance work.

For a larger public service, shard whole rooms behind a session/room directory and use a durable identity/rate-limit service. Do not merely add round-robin replicas: SSE and input must reach the same room authority. This is a deployment extension, not functionality secretly running in this ZIP.
