# Primary implementation references

These references informed interoperability and build choices. They were consulted for the delivery prepared on 2026-09-30. External projects' reports are attributed to those projects; this repository has no physical Peloton verification of its own. Its gameplay, art and server implementation are original.

## Bike interoperability

- OpenRide sensor protocol: https://github.com/digitalducktape/OpenRide/blob/main/docs/SENSOR_PROTOCOL.md — service action/package, V1 and Bike transaction numbering, one-way nullable callback framing, centiwatt scaling, first-valid-frame arbitration and upstream test configurations.
- OpenRide frame mapping: https://github.com/digitalducktape/OpenRide/blob/main/app/src/main/java/com/onepeloton/affernetservice/BikeData.kt — ordering of the fixed four-long/two-int frame prefix. Breakaway parses only that fixed prefix and does not redistribute Peloton binaries or implement unused control methods.
- OpenRide V1 binding: https://github.com/digitalducktape/OpenRide/blob/main/app/src/main/java/dev/digitalducktape/openride/core/sensor/PelotonBikeDataSource.kt — full interface action and explicit package binding. Breakaway's raw Binder adapter is independently implemented, not a bundled copy of this class.
- Android Binder API: https://developer.android.com/reference/android/os/Binder and https://developer.android.com/reference/android/os/IBinder — transactions, interface descriptors, death notifications and lifecycle expectations.

## Voice and secure Android shell

- Vosk Android documentation: https://alphacephei.com/vosk/android
- Vosk model catalog: https://alphacephei.com/vosk/models — small English US 0.15 model choice and model licensing. The model itself is downloaded by the build helper, not bundled in this delivery ZIP.
- Vosk Android demo dependencies: https://github.com/alphacep/vosk-android-demo/blob/master/app/build.gradle — reference pins for Vosk Android 0.3.75 and JNA 5.18.1.
- Android SpeechRecognizer: https://developer.android.com/reference/android/speech/SpeechRecognizer — availability checks, lifecycle, permissions and supported on-device paths. The platform fallback is not represented as guaranteed offline.
- Android local WebView content: https://developer.android.com/develop/ui/views/layout/webapps/load-local-content — local content and origin-security considerations.
- Browser SpeechRecognition: https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition — browser availability and provider-dependent processing caveats.
- Android Debug Bridge: https://developer.android.com/tools/adb — authorized shell, device discovery and APK installation.

## Build and CI

- Android Gradle Plugin 8.10: https://developer.android.com/build/releases/agp-8-10-0-release-notes — SDK 36 support and compatible Gradle/JDK requirements.
- Gradle distribution checksums: https://gradle.org/release-checksums/ — the helper retrieves the matching official distribution checksum rather than hardcoding an unverified value.
- Checkout workflow action: https://github.com/actions/checkout/blob/main/README.md — v7.
- Node setup action: https://github.com/actions/setup-node/blob/main/README.md — v7.
- Java setup action: https://github.com/actions/setup-java/blob/main/README.md — v6.
- Artifact action: https://github.com/actions/upload-artifact/blob/main/README.md — v4.

Before changing an undocumented protocol field, compare primary evidence, add a synthetic fixture and run the physical acceptance gate. Before updating tool/dependency versions, rerun the full build; these references are not a promise that future versions remain compatible.
