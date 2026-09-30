# Development and deployment

## Local development

Node 22+ is the only browser/server runtime prerequisite. `npm start` starts a loopback listener at port 8787. No npm packages need installation. `npm run dev` uses Node's watch mode. Copy `.env.example` to `.env` for optional settings; `PUBLIC_ORIGIN` should remain unset locally. The server reads `.env` automatically and does not commit it.

For another device on a trusted LAN, a development-only listener can use `HOST=0.0.0.0`. This alone does not make a remote browser microphone available: use HTTPS for voice. The Android debug build can be configured for HTTP testing, but the release build does not permit cleartext. Do not deploy the debug exception as your security model.

## Public HTTPS with Docker and Caddy

Use a Linux host you control with Docker/Compose, a real DNS name pointing to it, and inbound ports 80/443. Make a `.env` file with a real `RACE_DOMAIN` and a strong optional `ACCESS_CODE` for a private pilot. Never substitute a made-up example hostname and expect certificates to work.

```sh
# .env example values — replace them
RACE_DOMAIN=race.your-domain.example
ACCESS_CODE=replace-with-a-long-random-invitation-passphrase
```

```sh
docker compose up -d --build
docker compose logs -f game
```

Caddy terminates HTTPS and forwards to the internal game service. The game port is not published. Its event stream must not be buffered; the included Caddyfile sets immediate flushing. The container uses an unprivileged game process, a read-only root filesystem, a dedicated result-data volume, no extra Linux capabilities, a memory bound and a health check. These configuration files have not been executed against an actual cloud host for this delivery.

Open `https://<your-domain>` for the browser game and `https://<your-domain>/companion` on a phone. In the Android app, Settings → Multiplayer Server takes the HTTPS **origin only**, with no path, credentials or query. Enter the invitation passphrase on each client when configured. It is kept in memory, not persisted with normal settings.

Do not use a static-only host for the server: the process owns room state and long-lived SSE connections. Static hosting can serve the solo client, but real multiplayer requires the Node authority and correct CORS configuration.

## Operational limits

Defaults: eight riders per room, sixteen total room members including spectators, 32 rooms, 256 sessions, 8 KiB input bodies, bounded stream buffering and command/session rate limits. The localhost load test is evidence for that specific test host and workload, not a production SLA or a mobile-network measurement.

IP limits use the socket peer rather than blindly trusting forwarded headers. Behind a reverse proxy, clients share the proxy peer's limit. Default session creation is twenty per minute per peer; accommodate onboarding in batches or implement explicit trusted-proxy-aware limits before broad public launch. Do not simply trust arbitrary client-supplied `X-Forwarded-For` headers.

A server restart ends in-progress races and sessions. Wait for active races to finish before deploying; notify users and schedule a maintenance window for pilots. This release has no live rolling-room migration. Multiple replicas require room-affinity routing and a room directory; round-robin input/SSE requests will not work with independent memory maps.

## Persistence, backups and observability

The result journal is stored under `DATA_DIR` (or the `race-data` volume). It contains summary names/times/power/source, not raw audio or session tokens. It repairs torn lines at startup and periodically compacts recent records. Back it up through the volume while respecting the single-writer assumption; stop the process for the simplest consistent backup. Never run two processes against the same directory.

GET `/api/health` provides basic liveness/version information. Standard logs report startup and errors, not bearer credentials. Watch CPU, RSS, event-loop delay, request latency, errors, stale-sensor frequency and disconnects. The included load tool records these local metrics. Production telemetry, alerting and a managed dashboard are not provisioned in this ZIP.

## Android build and signing

Install Android SDK platform 36 and current compatible build tools through Android Studio/SDK Manager. Set `ANDROID_HOME` or `android/local.properties`; use JDK 17. The source pins Android Gradle Plugin 8.10.1, Gradle 8.11.1, Vosk Android 0.3.75 and JNA 5.18.1. The Python helper verifies Gradle's published checksum and handles the offline model. Initial model trust is HTTPS origin trust; record/review the generated SHA-256 lock and retain it for subsequent builds. Do not invent an independently verified model hash.

```sh
python scripts/prepare_android.py :app:testDebugUnitTest :app:assembleDebug
python scripts/prepare_android.py --skip-model :app:connectedDebugAndroidTest
```

The second command requires an attached emulator/device and an already configured test environment; it exercises synthetic Parcel fixtures, not a real sensor automatically. Release builds require the model to be present. A release APK is unsigned until you configure your own signing process. Keep the keystore/private key out of this repository and retain it across releases. Do not distribute debug keys as a production update identity.

The two included GitHub workflows run web/server verification and build an Android debug artifact after upload. Those workflows have **not run in GitHub for this delivery**. Treat their first result as a build gate, not a previously passed badge. Pin action/image digests and scan dependencies before a public commercial release.
