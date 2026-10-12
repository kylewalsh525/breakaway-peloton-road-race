# Voice controls, privacy and noisy-room acceptance

The voice system is command recognition, not a conversational LLM. Pedaling controls acceleration; voice controls discrete maneuvers. Neither an API key nor a game-server audio upload is required.

## Start a voice-controlled ride

1. Choose a working power source in Settings. Demo power can be used to try the game without a bike connection.
2. Select **Enable Voice**, review the speech-provider choice, and grant microphone permission. The first microphone permission grant still needs a tap.
3. Use these short commands, with a brief pause between commands: **left, right, center, hit, kick, block, boost, brake, coast, resume**. In a multiplayer lobby, say **ready**; the host can say **start**.
4. Run **Settings → Check voice commands** with your normal fan and music settings before racing.

The browser and packaged native offline grammar share the short aliases in `shared/voice.mjs`, including “punch”, “chain”, “swing chain” and “turbo”, plus their “rider” variants. “Chain” uses the attack action: it swings a chain when one is equipped and punches otherwise. Voice does not currently navigate every setup menu. It does not connect to ChatGPT Voice Mode or the OpenAI Realtime API.

## Recognition routes

**Native offline:** Android microphone → Vosk model → final phrase and word confidence → JavaScript VoiceGate → command. Audio remains within the tablet process. The English model is downloaded during Android preparation and packaged into the APK. Its first launch copies the packaged model into private app storage. A grammar containing all supported short phrases, prefixed variants and `[unk]` limits candidate words, but does not make recognition infallible.

**Platform fallback:** used only after explicit consent when offline setup is unavailable. Android's on-device recognizer is preferred when available; otherwise an installed recognition service may send audio to its provider. Do not describe this fallback as necessarily offline.

**Browser/phone:** Web Speech availability depends on the browser and context. Recognition may use the browser provider's remote services. The user sees this disclosure before enabling it. HTTPS or localhost and microphone permission are required. Ordinary Android WebViews are not assumed to provide browser speech or Google services.

The race server stores neither audio nor transcripts. The current transcript may appear transiently in the interface; it is not included in diagnostic or ride exports. Other speech providers have their own data policies, outside this game's storage controls.

## Gating and feedback

Only final results trigger actions. The confidence threshold defaults to 0.55; low-confidence results are ignored. Browser recognition providers that return uncertain/zero confidence may fail this gate, which is preferable to silently treating every result as reliable. Optional “rider” prefix reduces accidental activation. Exact phrase matching rejects sentences such as “don't go left” or “I left my phone.”

Utterance IDs suppress repeated final-result delivery. A 360 ms per-command gate reduces repeated detections; the authoritative simulation separately enforces attack, shield, boost and lane-command rules. A received command briefly highlights its button and plays a short acknowledgment. Combat never flashes the screen or hides a stunned rider. Attacks start on the next simulation tick and resolve damage once at the visible strike; repeated commands cannot restart an unfinished swing. Voice activity ducks the game's synthesized music to reduce competition with the recognizer.

Browser sessions restart after a normal end-of-speech timeout. Repeated provider failures stop retries and show an actionable status; enabling the microphone again starts a clean command session. Events queued by an older browser recognizer or a session-tagged native engine cannot trigger actions or disable a newly enabled microphone. Native platform silence/no-match outcomes keep listening instead of accumulating failures. Repeated identical partial transcripts avoid redundant UI updates. The legacy native bridge remains supported, but session rejection needs the updated Android shell. The client adds no delay after accepting a final result. Multiplayer commands that wait more than 450 ms behind an in-flight request are discarded, and failed transport clears pending commands so old attacks cannot fire after reconnection. The recognizer's end-of-phrase detection and multiplayer transport still determine actual response time. Acoustic latency has not been measured on a Peloton.

Native recognition uses local assets and does not require a working Peloton subscription. Microphone permission is requested only after an enable action. Denied permission, missing microphone, missing model, unavailable recognition service and repeated platform errors produce visible statuses. App hiding/pause disables capture; returning requires deliberate microphone re-enablement.

## Phone controller

From the multiplayer lobby choose **Pair phone controller**. Open the same server's `/companion` page on the phone, enter the eight-character code and enable the phone microphone. The one-use pairing code expires in two minutes. Pairing authorizes commands for one rider; it does not authorize changing that rider's telemetry or another rider's position. A separate sequence number prevents replay. Revoke it from the game at any time. Pairing is session-based and does not survive a server restart.

The phone must remain on the controller page with a usable microphone route. This build does not implement background mobile recording, wake-from-sleep recognition or a lock-screen voice assistant.

## What calibration means here

Settings → Check voice commands prompts for left, right, hit, kick, chain, block, boost and coast and records correct/incorrect recognized commands and confidence for that check. Repeated delivery of the same final result counts once. Gameplay actions are suppressed while the check runs, including a repeated final result arriving just after the last prompt. This is a setup diagnostic, not acoustic training, speaker identification, or a verified accuracy score.

## Physical acceptance plan

Run at least twenty repetitions of each command during quiet seated pedaling, normal fan noise and moderate breathing. Include conversational negative examples and silence. Record command accuracy, accidental actions, median/p95 end-to-end latency, misses, permission interruptions and CPU/temperature. Repeat with game music on and off, and with a phone or headset microphone when appropriate. Choose acceptance thresholds before collecting data; suggested pilot gates are ≥95% command accuracy in the intended room, fewer than one false action per ten minutes, and no missed physical-safety action assumption. Those are **proposed targets**, not achieved measurements.

Voice must never be treated as an emergency stop for the real flywheel. Keep comfortable effort and use normal bike controls. No microphone input or acoustic accuracy measurement was executed for this ZIP.

References: [Vosk Android](https://alphacephei.com/vosk/android), [model catalog](https://alphacephei.com/vosk/models), [Android SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer), [Chrome's recognition lifecycle and final/interim results](https://developer.chrome.com/blog/voice-driven-web-apps-introduction-to-the-web-speech-api/), [Web Speech behavior](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).
