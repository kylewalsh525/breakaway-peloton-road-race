# Combat and voice polish verification — 2026-10-11

This pass replaces blinking damage feedback with continuous rider rendering, directional recoil and 16-phase punch, kick and chain animations. Damage resolves once at the contact pose. The timings below were measured in local desktop Chrome and are not acoustic or Peloton hardware measurements.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Syntax, simulation, voice, network and HTTP/SSE tests | 185 passed; no failed or skipped tests; playable assets generated | `artifacts/combat-verification.txt` |
| Full rendered UI and complete solo race regression | 55 checks passed; zero uncaught errors | `artifacts/retro-browser-test.json`, `artifacts/combat-ui-verification.txt` |
| Browser and native provider callback fixtures through the real solo app | 43 checks passed, 28 timing samples: 28.9 ms median, 33.1 ms p95, 33.3 ms maximum | `artifacts/combat-voice-browser-test.json` |
| Recognized command fixture through real multiplayer HTTP/SSE | 8 checks passed; 7 samples: 30.3 ms median, 65.1 ms p95 | `artifacts/combat-network-test.json` |
| Combat rendering and visibility | Every stunned rider drawn across 120 sampled frames; no full-screen flash; 8 combatants at approximately 60 FPS | `artifacts/combat-render-test.json` |
| Attack direction, art bounds and phase stability | 576 pose combinations; no clipped sprites; same attack timer yields same pose regardless of wall clock; cache bounded at 192 | `artifacts/combat-bounds-checks.json`, `artifacts/combat-poses.png` |

Warmed rendering sampled 120 frames per quality: draw p95 was 1.0 ms low, 1.1 ms classic/auto and 1.1 ms high. These are draw costs, not whole-game input latency or a target-tablet guarantee. Solo callback timing excludes audio capture and speech recognition. Multiplayer timing includes the real local server and SSE but excludes the 95 ms position presentation buffer. Slow-POST and failed-POST tests verified that old queued attacks were discarded instead of firing late.

Voice checks cover punch/kick/chain aliases, steering/center, block, boost, brake, coast/resume, start, duplicate results after cooldown, stale sessions, confidence/interim rejection and 1,000 repeated partial callbacks per provider. Native Java vocabulary is checked against the shared aliases. Android Java changes were not compiled or run; no physical microphone, actual speech recognition, Peloton, remote network or public deployment was tested. Those remaining checks require the target device and microphone environment.

Reproduce after `npm run build` and with Playwright/Chrome available:

```sh
npm run verify
npm run test:ui
# Start npm start for the render/network checks:
npm run test:combat-render
npm run test:combat-voice
npm run test:combat-network
```

---

# Current rebuild verification — 2026-10-11

The Genesis presentation rebuild was tested on local macOS with installed Google Chrome. This section supersedes presentation/browser counts below; the September report is retained as historical evidence.

| Check | Observed result | Evidence |
| --- | --- | --- |
| Syntax, unit tests, simulation and real HTTP/SSE integration | 162 tests passed; build generated web, standalone and Android web assets | `artifacts/retro-verification.txt` |
| Rendered UI, synthetic native voice and complete solo race | 55 checks passed; zero uncaught JavaScript errors | `artifacts/retro-browser-test.json` |
| Separate browser contexts for two riders and paired phone | 19 checks passed; zero uncaught JavaScript errors | `artifacts/multiplayer-browser-test.json` |
| Renderer camera/depth/mirror checks and warmed rendering | Camera and trailing-rider checks passed; six rear-readability checks passed; auto-quality render p95 1.3 ms in this desktop sample | `artifacts/retro-renderer-performance.json`, `artifacts/retro-rear-readability.json` |

UI checks cover 1440×900, 1920×1080, 1024×600 and 390×844. Built-in commands were exercised through synthetic native speech results; bike frames were synthetic. The full solo finish uses an accelerated test clock. Real browser/server transport was exercised, but no physical Peloton, microphone recognition, Android APK, public hosting or internet latency was validated. Renderer timings measure draw cost, not end-to-end speech latency. Solo poses now interpolate between fixed simulation ticks; simulation authority and multiplayer buffering remain intact.

---

# Executed test report — source delivery 0.9.0

Delivery verification date: **2026-09-30**. This report distinguishes executed tests from supplied but unexecuted test/build configuration. Original source and generated playable assets are included in the ZIP.

## Results actually observed

| Check | Result | Evidence |
| --- | --- | --- |
| JavaScript syntax / basic embedded-token pattern check | 26 modules passed | artifacts/verification.txt |
| Node unit, simulation and real-server integration tests | **141 passed; 0 failed, skipped or cancelled** | artifacts/verification.txt |
| Separate Node coverage run | **141 passed** | artifacts/node-coverage.txt |
| Rendered Chromium UI / synthetic native event integration | **45 checks passed**, no uncaught JavaScript errors | artifacts/browser-test.json |
| Browser complete-race flow | Finish, results, XP award and replay passed | artifacts/results-complete-race.png and browser report |
| Pure-Java telemetry mapper | **7 named checks and 24,341 valid combinations passed** | artifacts/java-mapping.txt |
| Java source syntax | 6 Java files parsed by the real JDK compiler parser | artifacts/java-syntax.txt |
| Android XML syntax | 5 documents parsed | artifacts/environment.json |
| Production-asset generation | Browser files, standalone HTML and Android packaged web assets generated | artifacts/verification.txt |
| Real localhost HTTP/SSE load smoke test | **32 simultaneous riders / 4 rooms; no errors or dropped simulation steps** | artifacts/load-test.json |

Java parsing is syntax-only: it does **not** resolve Android APIs or Maven dependencies. The mapper is the only native component compiled and executed in this environment. XML parsing is not Android resource compilation.

## Node coverage interpretation

The executed coverage report records 100% line coverage for `shared/simulation.mjs`, `shared/telemetry.mjs`, `shared/voice.mjs`, `shared/protocol.mjs`, `shared/profile.mjs`, `shared/tracks.mjs`, `server/security.mjs` and `server/store.mjs`. It records 88.30% line coverage for `server/app.mjs` and 90.45% for `client/network.mjs`.

These values describe this **Node test run's instrumented files**, not the whole product. Browser rendering/audio/UI modules and Android platform code are not included. The report's aggregate includes test files and must not be presented as whole-application coverage. Line coverage is not proof that every behavior or failure mode is correct. A separate browser suite exercises actual layout, drawing and input routing.

Node tests cover voice confidence/duplicates/negative phrases; payload and number validation; stale providers and Bluetooth frame decoding; fixed-step determinism and all four courses; steering, drafting, attacks, parries, hazards, boosts and finishes; actual room/auth/origin/role/phone-pair HTTP endpoints; event-stream delivery; client-network recovery; stable race IDs and input-sequence restoration; and result-journal repair/compaction. A regression test bounds the wait after the first human finishes to 45 seconds.

## Rendered browser checks

The suite ran in Chromium (Chromium 144.0.7559.96 built on Debian GNU/Linux 13 (trixie)) using the actual standalone HTML bundle. It completed in 26.63 seconds. It exercised desktop layout, course selection, settings/help, actual simulation controls, responsive layouts at 390×844, 1024×600 and 1920×1080, the unavailable-sensor state, synthetic native frames, voice confidence and duplicate gates, stale-data zeroing, microphone denial presentation, and a complete solo finish/results/replay flow. Rendered screenshots were also visually inspected.

The browser environment does not permit normal URL navigation or actual microphone capture. Tests therefore load the HTML through Playwright's `set_content`; they do not disable browser policies. Native bridge events are synthetic. The full-race test accelerates the animation clock. These tests demonstrate client execution and command routing, **not acoustic recognition, physical bike input, real-time endurance performance or a public-network browser session**. Actual HTTP/SSE and the client network class were separately exercised against the running Node server in integration tests.

## Local load test observations

The actual Node server ran for 6.19 seconds with 4 rooms and 32 simulated riders, continuous event streams and repeated inputs. It handled 1,124 measured requests and delivered 2,840 snapshots.

| Measurement | Observed |
| --- | --- |
| Request p50 | 11.34 ms |
| Request p95 | 17.54 ms |
| Request maximum | 47.53 ms |
| Event-loop p99 delay | 17.73 ms |
| Process RSS | 113.56 MiB |
| Average downstream per rider | 76.55 KiB/s |
| Dropped simulation steps | 0 |
| Recorded errors | 0 |

This is a short **localhost smoke/load test**, not an internet latency study, production SLA, many-hour soak or capacity guarantee. The event-stream bandwidth is material and should be profiled on the target connection before scaling. The tested release sends full bounded snapshots, not a highly compressed delta protocol.

## Not executed / not certified

- Android Gradle build, dependency resolution, resource processing, APK assembly and release signing. The delivery environment has Java but no Android SDK/Gradle dependency access. **There is no built APK in this ZIP.**
- Android instrumentation tests. Synthetic Parcel fixtures and a build workflow are supplied, but were not run on an emulator/device.
- Real Peloton sensor-service binding, real firmware installation permissions, on-device polling and sleep/reboot behavior. Upstream OpenRide observations are not certification of Breakaway.
- Actual Vosk or browser/platform microphone recognition, accents, breathing/fan noise, false-activation rates or end-to-end speech latency. The model is fetched during Android preparation; it is not bundled here.
- Physical tablet thermal/FPS/ergonomic soak, real Bluetooth peripheral connection, and a multi-device race on representative impaired networks.
- Docker/HTTPS cloud execution, GitHub Actions execution, penetration testing, public-service operations or formal accessibility certification.

These remain explicit release gates in [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) and [HARDWARE_ACCEPTANCE.md](HARDWARE_ACCEPTANCE.md). The source implementation should not be labeled universally firmware-compatible or production-certified on the strength of synthetic tests.

## Reproduce

```sh
npm run verify
npm run test:coverage
python scripts/test_java.py
npm run test:load
# With Playwright and Chromium installed:
npm run test:e2e
```

Environment: Node v22.16.0, Python 3.13.5, openjdk version "21.0.11" 2026-04-21. Scripts overwrite their current report files. Server integration tests use temporary storage and isolated listening ports. No production secrets or user-account credentials are needed for the local suite.
