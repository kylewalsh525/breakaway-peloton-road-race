# Security and privacy

This source release is intended for a controlled pilot, not an independently audited public service. Report a suspected vulnerability privately to the owner of the repository where this project is uploaded. Do not publish access codes, bearer tokens, microphone recordings, device serial numbers or keystores in issues.

## Trust boundaries

The race server owns position, damage, pickups, race timing and results. A client submits bounded telemetry and commands, not authoritative world state. The server validates schema, number ranges, sequence numbers, room membership and rider/controller/spectator roles. A modified client can still invent plausible wattage. No leaderboard is represented as power-attested or suitable for prizes.

Sessions use random bearer tokens. Tokens stay out of URLs and referrers; authentication is carried in request headers. Phone pairing uses a short-lived, one-use code and grants a separate command-only role. Pairing never delegates sensor input or host privileges. Codes are intended for direct sharing with a trusted rider, not publication. Logout/revocation and server restarts invalidate relevant sessions.

HTTP limits cover JSON body size, room/session/member counts, session creation, input rates and event-stream backpressure. Strict origin checks and preflight handling are separate from authentication. Production should use HTTPS with the included reverse-proxy pattern, a private-pilot access code, host-level firewall rules and a real operator. Rate limiting alone is not DDoS protection. Behind the included proxy, IP quotas use its socket address; see DEPLOYMENT.md before onboarding a large group.

## Native bridge

The Android application loads packaged local game files, not an arbitrary remote website with privileged JavaScript access. The bridge exposes narrow sensor/voice/preferences/export operations. Remote navigation is blocked; frames and arbitrary script injection are restricted by content policy. File and content URL access are disabled. Exports use the Android document chooser and bounded text, not unrestricted filesystem writes. The release network policy rejects cleartext traffic. The debug exception and WebView debugging must not be shipped as a production configuration.

Sensor integration is read-only. Calls are restricted to documented callback registration, unregistration and one read method, with interface-descriptor and frame-range checks. No root, calibration, fake-data mode, firmware flashing or physical-resistance writes are implemented. An undocumented interface can change in a way that remains superficially valid: runtime validation reduces risk but does not prove semantic compatibility. Unknown behavior requires a physical acceptance run and, when necessary, disabling the provider.

## Audio and personal data

Vosk recognition in the Android app is local when its model is installed. Browser recognition and an explicitly enabled platform fallback may process speech with the platform provider; the UI explains that choice. This project does not transmit audio to the race server or store microphone recordings. Native capture stops when the activity becomes inactive; denied or unavailable microphone access is not treated as success.

Local career records are stored on the device. The server stores recent summary race results with rider display names and telemetry-source labels. It does not implement synchronized accounts, personal-data deletion requests or a public-service privacy policy. Operators must decide retention and user notices before opening a public service. Deleting local site data resets local career information. Do not choose a real full name unless comfortable sharing it with race participants and the operator.

## Supply chain and release process

Browser and server runtime code use no third-party npm packages. Android builds download pinned Maven dependencies and an offline Vosk model; Python's helper verifies the Gradle distribution checksum and locks the model digest after the initial HTTPS download. Review and retain that lock. No independently verified model checksum is invented or assumed.

Do not commit `.env`, signing keys, Android `local.properties`, access codes or result journals. Keep a stable private signing key for updates. Review dependency advisories and pin trusted workflow/image digests before a commercial release. The supplied automated checks, simple credential-pattern scan and test coverage are not a penetration test, software-composition audit or security certification.
