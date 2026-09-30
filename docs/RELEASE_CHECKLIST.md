# Release gates

Source delivery **0.9.0** implements the arcade race loop; it is not a signed, hardware-certified public release. These gates deliberately remain separate.

| Gate | Delivery status | Evidence / next action |
| --- | --- | --- |
| Browser/server syntax and unit/integration tests | Passed | artifacts/verification.txt |
| Rendered UI, synthetic native events and complete solo loop | Passed | artifacts/browser-test.json and screenshots |
| Local 32-rider HTTP/SSE load smoke test | Passed | artifacts/load-test.json; not a soak/SLA |
| Pure-Java telemetry mapper | Passed | artifacts/java-mapping.txt |
| Android Java source syntax | See test report | Parse-only check does not resolve Android dependencies |
| Full Android compilation and APK assembly | Not executed | Run prepare_android.py on a configured SDK machine |
| Synthetic Android instrumentation | Not executed | Run connectedDebugAndroidTest |
| Physical sensor and firmware matrix | Not executed | HARDWARE_ACCEPTANCE.md |
| Actual microphone accuracy and latency | Not executed | Acoustic acceptance run, including noise and denial |
| Physical tablet graphics/thermal soak | Not executed | 45-minute target-hardware session |
| Real devices over a public/variable-latency network | Not executed | Representative multi-device race and recovery tests |
| Docker/HTTPS cloud deployment | Not executed | Deploy, observe and test the provided configuration |
| GitHub workflows | Not executed | First runs after repository upload |
| Public security/privacy/distribution review and release signing | Not executed | Owner's production release process |

Do not turn “not executed” into “passed” without evidence. Store run logs with exact app/device versions and use separate compatibility records for different firmware builds.
