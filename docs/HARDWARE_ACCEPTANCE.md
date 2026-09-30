# Peloton and microphone acceptance gate

**Delivery status: not executed on physical hardware. No firmware is certified by this project yet.** Upstream protocol observations are useful implementation inputs, not test results for this APK. A clean build is the first gate, not the final one.

## Record the configuration

Use one record per tablet/build. Record app version and commit/ZIP SHA, tablet model, Android/API level, Peloton build, sensor-service package/version, WebView version, microphone presence, network configuration and whether a subscription is active. Do not include the serial number in public reports. Record whether the APK installs and whether returning to the stock Peloton application still works.

## Build and installation

On a networked development machine with JDK 17 and SDK 36, run `python scripts/prepare_android.py`. Require JVM tests and `assembleDebug` to pass. Install through authorized USB debugging on the owner's device. Run the synthetic instrumentation fixtures with `:app:connectedDebugAndroidTest`; label them synthetic. Retain the model lock and dependency/build logs. A signing or package-manager rejection is a blocked configuration, not a reason to bypass platform security.

## Live sensor run

1. With the bike stationary, open Diagnostics. Confirm it distinguishes binding/probing from receipt of an actual valid frame. Record the selected provider and observed sample interval.
2. Pedal gently, then vary cadence and the physical resistance knob. Compare cadence, resistance and watts to the stock bike display across several steady points. Do not run competing foreground applications or assume two apps show precisely simultaneous samples. Investigate offsets/scaling rather than changing arbitrary constants until numbers look plausible.
3. Confirm zero power when stopped, no automatic demo substitution, plausible values through rapid-but-safe effort changes, and correct centiwatt conversion. Capture at least a ten-minute trace without recording unnecessary device identifiers.
4. Background/foreground the game, sleep/wake the tablet and reboot. Check fresh probes, no duplicate callbacks, no accumulated stale power, correct microphone state, and stock-app operation afterward.
5. In a controlled developer fixture, make an adapter silent or kill its service connection. Verify no-live-frame status, zero propulsion after 2.5 seconds, read-only fallback after the probe window and bounded reconnect attempts. Do not physically unplug sensor wiring while pedaling.
6. Record supported/blocked/degraded with logs. An unknown firmware update returns the configuration to **needs revalidation** until these checks pass again.

## Acoustic run

Grant microphone permission deliberately. Start with the local model and no platform fallback consent; confirm it works without internet access. Test permission denial, revocation, missing model, absent recognizer, audio interruptions and a competing microphone application. Confirm visibly stopped recognition when backgrounded and no automatic capture after returning.

In a safe stationary/low-effort setting, then at a personally comfortable riding effort, speak all steering/combat commands in quiet conditions and with the intended fan/speaker volume. Run at least twenty repetitions per command from the real riding position. Include ordinary non-command speech, silence and repeated phrases; test the optional “rider” prefix. Measure missed commands, false activations and final-recognition-to-action delay. Keep physical stopping independent of voice.

Suggested product targets—not measured promises—are at least 95% correct intended commands in the chosen acoustic setting, fewer than one unwanted activation per ten minutes, and sub-500 ms median command response. Decide acceptable p95 latency from actual riding trials. Revise vocabulary/model/audio settings or require a closer microphone/phone when the target is missed. A confident recognizer output alone is not proof of safe or responsive control.

## Graphics and multiplayer soak

Measure frame time, memory and thermal behavior on each target tablet at native and reduced rendering quality. Use a 45-minute comfortable session, with menu transitions and three or more complete races. Record p50/p95 frame times rather than relying on a momentary FPS counter. Inspect arm's-length HUD readability, screen glare and touch reach while not compromising riding posture.

Run at least two physical clients against the actual HTTPS server. Exercise private rooms, ready/host transfer, quick race, combat, spectators, rematch, phone pairing/revocation and finishing with a stopped rival. Interrupt Wi-Fi briefly, reload during a race, let another participant disconnect and test a protocol-version mismatch. Then test a sustained eight-human race with representative network delay. The localhost 32-client test is not a substitute.

## Sign-off template

```text
App / source SHA:
Model / Android / firmware / WebView:
Install: pass / blocked
Sensor provider and sample interval:
Idle, live-load and stale tests:
Sleep, resume and reboot tests:
Offline voice accuracy / false activations / p50 / p95:
Microphone denial / interruption / foreground recovery:
Graphics p50 / p95 / soak duration:
Multiplayer participants / network / reconnect result:
Known limitations and required fallback:
Tester / date / evidence location:
Verdict: experimental / supported with limitations / blocked
```

Release signing, public-service operational readiness, privacy notices and distribution are separate gates. Do not mark an entire Bike generation supported based on one tested build.
