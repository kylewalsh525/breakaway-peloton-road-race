# Third-party notices

The web game, its graphics, synthesized music, server, and Android integration source were authored for this project. No Road Rash artwork, music, ROM, source code, character likenesses, or branding is included. BREAKAWAY is a working project name, not a trademark clearance opinion. No Peloton class content, proprietary APK, firmware, or font file is distributed.

The server and browser have **no external runtime package dependencies**. Node.js, Chromium, Java, Python, and developer tools retain their own licenses and are not included in the source ZIP.

Android dependencies are downloaded during a build, not included as precompiled libraries in this ZIP:

| Dependency | Version | Upstream / license |
| --- | --- | --- |
| Vosk Android | 0.3.75 | https://github.com/alphacep/vosk-api — Apache-2.0 |
| Vosk small English model | small-en-us-0.15 | https://alphacephei.com/vosk/models — listed Apache-2.0 |
| JNA | 5.18.1 | https://github.com/java-native-access/jna — LGPL-2.1-or-later OR Apache-2.0 |
| JUnit (tests) | 4.13.2 | https://github.com/junit-team/junit4 — EPL-1.0 |
| AndroidX Test (tests) | runner 1.6.2, ext 1.2.1 | https://android.googlesource.com/platform/frameworks/testing — Apache-2.0 |
| Playwright (optional UI tests) | 1.55.0 in CI | https://github.com/microsoft/playwright — Apache-2.0 |

Preserve each downloaded distribution's license and notice files when redistributing an APK. The model preparation script copies the model directory, including its notices. Include applicable Vosk/JNA notices with a commercial distribution. Review upstream dependencies before release; no independent legal clearance is asserted here.

Peloton service names and wire identifiers are used for interoperability with the owner's device. Protocol facts were informed by OpenRide and Grupetto's public work; this adapter is an independently authored, minimal read-only Binder implementation. See [sources](docs/SOURCES.md).
