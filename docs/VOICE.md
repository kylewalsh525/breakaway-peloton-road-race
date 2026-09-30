# Voice controls, privacy and noisy-room acceptance

The voice system is command recognition, not a conversational LLM. Pedaling controls acceleration; voice controls discrete maneuvers. Neither an API key nor a game-server audio upload is required.

## Recognition routes

**Native offline:** Android microphone → Vosk model → final phrase and word confidence → JavaScript VoiceGate → command. Audio remains within the tablet process. The English model is downloaded during Android preparation and packaged into the APK. Its first launch copies the packaged model into private app storage. A grammar containing the canonical commands, prefixed variants and `[unk]` limits candidate words, but does not make recognition infallible.

**Platform fallback:** used only after explicit consent when offline setup is unavailable. Android's on-device recognizer is preferred when available; otherwise an installed recognition service may send audio to its provider. Do not describe this fallback as necessarily offline.

**Browser/phone:** Web Speech availability depends on the browser and context. Recognition may use the browser provider's remote services. The user sees this disclosure before enabling it. HTTPS or localhost and microphone permission are required. Ordinary Android WebViews are not assumed to provide browser speech or Google services.

The race server stores neither audio nor transcripts. The current transcript may appear transiently in the interface; it is not included in diagnostic or ride exports. Other speech providers have their own data policies, outside this game's storage controls.

## Gating and feedback

Only final results trigger actions. The confidence threshold defaults to 0.55; low-confidence results are ignored. Browser recognition providers that return uncertain/zero confidence may fail this gate, which is preferable to silently treating every result as reliable. Optional “rider” prefix reduces accidental activation. Exact phrase matching rejects sentences such as “don't go left” or “I left my phone.”

Utterance IDs suppress repeated final-result delivery. A 360 ms per-command gate reduces repeated detections; the authoritative simulation separately enforces attack, shield, boost and lane-command rules. A received command flashes its label and plays a short acknowledgment. Voice activity ducks the game's synthesized music to reduce competition with the recognizer.

Native recognition uses local assets and does not require a working Peloton subscription. Microphone permission is requested only after an enable action. Denied permission, missing microphone, missing model, unavailable recognition service and repeated platform errors produce visible statuses. App hiding/pause disables capture; returning requires deliberate microphone re-enablement.

## Phone controller

From the multiplayer lobby choose **Pair phone controller**. Open the same server's `/companion` page on the phone, enter the eight-character code and enable the phone microphone. The one-use pairing code expires in two minutes. Pairing authorizes commands for one rider; it does not authorize changing that rider's telemetry or another rider's position. A separate sequence number prevents replay. Revoke it from the game at any time. Pairing is session-based and does not survive a server restart.

The phone must remain on the controller page with a usable microphone route. This build does not implement background mobile recording, wake-from-sleep recognition or a lock-screen voice assistant.

## What calibration means here

Settings → Check voice commands prompts for left, right, hit, block, boost and coast and records correct/incorrect recognized commands and confidence for that check. Gameplay actions are suppressed while the check runs. This is a setup diagnostic, not acoustic training, speaker identification, or a verified accuracy score.

## Physical acceptance plan

Run at least twenty repetitions of each command during quiet seated pedaling, normal fan noise and moderate breathing. Include conversational negative examples and silence. Record command accuracy, accidental actions, median/p95 end-to-end latency, misses, permission interruptions and CPU/temperature. Repeat with game music on and off, and with a phone or headset microphone when appropriate. Choose acceptance thresholds before collecting data; suggested pilot gates are ≥95% command accuracy in the intended room, fewer than one false action per ten minutes, and no missed physical-safety action assumption. Those are **proposed targets**, not achieved measurements.

Voice must never be treated as an emergency stop for the real flywheel. Keep comfortable effort and use normal bike controls. No microphone input or acoustic accuracy measurement was executed for this ZIP.

References: [Vosk Android](https://alphacephei.com/vosk/android), [model catalog](https://alphacephei.com/vosk/models), [Android SpeechRecognizer](https://developer.android.com/reference/android/speech/SpeechRecognizer), [Web Speech behavior](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition).
