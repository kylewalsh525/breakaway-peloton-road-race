# Protocol 1 / HTTP and SSE

## Transport and identity

POST bodies are JSON objects, at most 8 KiB, with `Content-Type: application/json` and `X-Breakaway-Client: 1`. Except for session creation, state-changing routes require `Authorization: Bearer <token>`. GET `/api/me`, `/api/leaderboard` and `/api/stream` also require bearer authorization. Tokens are random, in-memory, stored in browser sessionStorage, and never accepted in URL query parameters.

`POST /api/session` body: `{ "protocol": 1, "name": "Rider", "accessCode": "optional invitation passphrase" }`. Response: `{ "token": "...", "id": "...", "name": "...", "protocol": 1, "version": "0.9.0" }`. Protocol mismatches fail before a room is joined. A room invitation code is not a substitute for a session token.

The same-origin web client and the packaged Android origin are accepted. Deployed cross-origin clients require exact configured origins; wildcard origins and `Origin: null` are not accepted. The non-browser command-line client can omit Origin but must still authenticate.

## Routes

| Method and path | Body / behavior |
| --- | --- |
| GET `/api/health` | Liveness/version/room count; no session needed |
| POST `/api/session` | Creates a bounded guest session; optional server invitation passphrase |
| GET `/api/me` | ID, name, current room, next rider/controller sequence numbers |
| GET `/api/stream` | Authenticated SSE: hello, room, state, heartbeat, pairing, command and shutdown messages |
| POST `/api/profile` | Name, chosen FTP baseline and allowed jersey color |
| POST `/api/rooms/create` | trackId, mode, difficulty; creates a private lobby |
| POST `/api/rooms/quick` | Finds/creates a matching quick lobby and readies the rider |
| POST `/api/rooms/join` | code; optional spectator=true |
| POST `/api/rooms/leave` | Empty object; marks an active rider withdrawn and transfers host |
| POST `/api/rooms/ready` | ready=true/false; spectators cannot ready |
| POST `/api/rooms/start` | Empty object; host plus all-riders-ready check |
| POST `/api/rooms/rematch` | Host only after finish; resets ready state |
| POST `/api/input` | Monotonic sequence, actions and optional telemetry |
| POST `/api/pair/create` | Returns eight-character, 120-second one-use code |
| POST `/api/pair/claim` | code; authorizes this session to control the paired rider |
| POST `/api/pair/revoke` | Revokes controller and pending pairing codes |
| POST `/api/control` | seq and one canonical command; pair-scoped authorization |
| POST `/api/ping` | Authenticated keep-alive/server time |
| GET `/api/leaderboard?track=coast&mode=arcade` | Up to twenty recent qualifying unverified times |
| POST `/api/logout` | Revokes session, pairing and room membership |

Typical errors are 400 for malformed input/protocol, 401 for absent/expired bearer, 403 for denied origin/role, 404 for missing resource/code, 409 for conflicting race state, 413 for oversized body, 415 for wrong content type, 429 for rate limits, and 503 for configured capacity.

## Rider input

```json
{
  "seq": 125,
  "actions": ["left", "boost"],
  "telemetry": {
    "watts": 220,
    "cadence": 85,
    "resistance": 43,
    "source": "peloton-v1",
    "stale": false
  }
}
```

The server accepts at most six valid actions per packet and removes duplicates. Sequence numbers must be nonnegative safe integers and strictly increase per rider. Stale or replayed packets do not repeat attacks or steering. Telemetry ranges are 0–2500 W, 0–240 rpm and 0–100 resistance; NaN, strings and infinities fail validation. Client position, health, finish time and target-rider claims are ignored rather than incorporated into the authority.

Sources: demo, peloton-v1, peloton-bike, peloton-poll, bluetooth-power, bluetooth-ftms, external. A source label is **not** cryptographic hardware attestation. `stale:true` zeros propulsion immediately; lack of accepted updates independently expires it after 2.5 seconds.

The client sends fresh measurements at roughly 5 Hz and sends actions promptly when no request is already in flight. A failed action request is not replayed after a reconnect. Phone controls use a separate sequence stream, so they cannot overwrite telemetry sequence numbers.

## Event stream

Each message is `data: <JSON>\n\n`. Fetch streaming is used rather than EventSource so authorization can stay in a header. `hello` includes identity, protocol and next input sequences. `room` includes code, course, mode, phase, stable race ID, host, member statuses and quick-start time. `state` includes tick, race time, phase, track objects, recent event IDs and ordered rider presentation fields. `heartbeat` is sent every ten seconds; a quiet connection is aborted and retried by the client after its watchdog threshold.

The server steps at 30 Hz and sends snapshots at 15 Hz. Timesteps are server-controlled and catch-up is bounded. The renderer interpolates positions; it never reports authoritative outcomes back to the server. An output buffer exceeding 128 KiB causes a slow stream to close rather than accumulate indefinitely. Reconnecting replaces the prior stream and restores the original rider.

Race IDs, not tick counts alone, define a new race. On a reload `/api/me` and `hello` restore the next valid sequence. Session/room state does not survive a server process restart; clients must join a new session/room afterward. There is no exactly-once replay of delayed combat across outages.

## Version policy

Increment protocol major when interpretation or authority fields change. A major mismatch fails with an update message rather than trying an unsafe downgrade. The app version may change without a protocol change for presentation-only fixes. Keep native telemetry schemas separate from the multiplayer contract so a new device provider does not require changing the racing protocol.
