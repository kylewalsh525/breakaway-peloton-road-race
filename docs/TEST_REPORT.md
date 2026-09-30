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
