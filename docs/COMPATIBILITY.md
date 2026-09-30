# Peloton compatibility and lifecycle strategy

## Evidence is not certification

No physical Peloton was connected during this build. The following are **upstream observations**, not successful tests of Breakaway:

| Upstream reported device | Reported build | Reported interface |
| --- | --- | --- |
| Bike Gen 2, PLTN-RB1VQ, Android 11 | RQ.250113.A | IV1Interface; approximately 1 Hz |
| Bike+, PLTN-TTR01, Android 10 | QT.250804.A | IBikeInterface; approximately 21 Hz |

Source: OpenRide's [sensor protocol notes](https://github.com/digitalducktape/OpenRide/blob/main/docs/SENSOR_PROTOCOL.md). Breakaway has **zero physically certified firmware/device tuples** at delivery. Do not relabel this table as a support guarantee.

## Runtime decision tree

The shell first determines whether the local game can render and whether the tablet advertises a microphone. It binds the documented V1 and Bike actions under `com.onepeloton.affernetservice`, checks the returned Binder descriptor, and registers read-only callbacks. A successful bind with no data is still probing, not connected.

The first plausible decoded frame wins. An inactive provider cannot replace a currently healthy one. After five seconds with no frames, the Bike interface can try the documented read-only `getBikeData` poll; a previously active stream becomes stale after 2.5 seconds. Provider death/unbinding triggers a bounded retry path. No fake-data mode, resistance command, calibration method or firmware method is invoked.

The fixed header contains cadence, centi-watts, two uninterpreted longs, current resistance and target resistance. Only measured cadence, watts and current resistance are exposed. Scaling and ranges are tested separately. The parser consumes the documented fixed prefix and discards the remainder of a single callback parcel; it does not invent layouts for changed services. Plausibility checks cannot prove semantic correctness after a firmware change—cross-checking against the actual bike remains mandatory.

## Compatibility layers

| Layer | Requirement / behavior |
| --- | --- |
| Installation | The owner must be able to install their own APK; blocked signature policies are not bypassed |
| Android runtime | API 26+ in this source build; ARM32, ARM64 and x86_64 ABIs configured |
| Web runtime | Chrome/WebView 90+ baseline; startup diagnostic covers unsupported module/runtime behavior |
| Local sensor service | Documented descriptor and frame layout; data receipt, not model-name heuristics, establishes liveness |
| Microphone | Feature detection, RECORD_AUDIO grant, usable input route and a functioning recognizer |
| Native speech | Packaged Vosk model preferred; explicit consent before platform provider fallback |
| Multiplayer | HTTPS server origin, protocol version 1, authenticated event stream |
| Old/locked tablet fallback | Separate screen/browser with a supported BLE Cycling Power/FTMS source; voice may run on paired phone |

A paired phone provides **commands**, not Peloton power measurements. It cannot make an inaccessible tablet service readable. Browser Bluetooth also requires a bike/meter that actually advertises the relevant standard; this project does not assert that every Peloton does so. Legacy Peloton Messenger sensor protocols, undocumented future Bike/Pro devices and arbitrary alternative framings are not implemented or claimed compatible.

## Before and after an update

Record the model, Android version, build, WebView version, selected provider and observed sample rate from device diagnostics. Do not export a serial number or authentication token. Test both stationary and pedaling states, compare power/cadence/resistance with a trusted display, then test a complete race.

Repeat those checks after an OS/firmware/WebView update. A known working tuple should move back to “needs verification” after a relevant update. Keep a previously signed application release and its matching protocol server available for rollback; do not downgrade or root the bike merely to force an integration. Retain the app signing key so upgrades do not require deleting app data.

Suggested support states are **unverified**, **synthetic-only**, **physical pilot passed**, **regressed**, and **unsupported**. The delivered native adapter is synthetic-only at most: its pure mapper ran, while its Android Binder instrumentation tests have not run in this environment.

## Safe ADB setup

On an owner's compatible tablet, enable developer options and USB debugging through the normal settings. Authorize one trusted computer. Useful read-only diagnostics:

```sh
adb devices
adb shell getprop ro.product.model
adb shell getprop ro.build.version.release
adb shell getprop ro.build.display.id
adb shell dumpsys webviewupdate
adb shell pm list packages
```

Then install the application built from this source. Do not uninstall or disable Peloton system apps, change update services, flash firmware, or open ADB to the internet. Revoke debugging authorization after development. ADB availability is itself firmware-dependent.

Sources: [Android ADB](https://developer.android.com/tools/adb), [local WebView content](https://developer.android.com/develop/ui/views/layout/webapps/load-local-content), and [source notes](SOURCES.md).
