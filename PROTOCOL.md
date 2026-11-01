# Phone ↔ PC link

Focus on the Pixel and Focus on Windows talk through an end-to-end encrypted channel on the public
ntfy.sh relay. ntfy only ever sees ciphertext. Both devices must share a pairing code.

## Pairing code
- The PC makes it: 16 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, shown as `XXXX-XXXX-XXXX-XXXX`.
- The phone types it in. Normalize: uppercase, drop everything that isn't in the alphabet.
- `key   = SHA-256("focus-key:"   + code)`  → 32-byte AES-256 key
- `topic = "focus-" + hex(SHA-256("focus-topic:" + code))[0:40]`

## Wire format
- Plaintext is a UTF-8 JSON envelope:
  `{"v":1,"from":"phone"|"pc","id":"<12 hex>","at":<epoch ms>,"t":"<type>", ...type fields}`
- Encrypt with AES-256-GCM, a random 12-byte IV, 128-bit tag.
  Wire string = base64 (standard, no line breaks) of `IV || ciphertext || tag`
  (this is exactly what Java's `Cipher.doFinal` output appended to the IV gives you).
- Keep the wire string under 4000 bytes (ntfy's limit): plaintext under ~2900 bytes.
- Publish: `POST https://ntfy.sh/<topic>`, body = wire string, `Content-Type: text/plain`.
- Subscribe: `GET https://ntfy.sh/<topic>/json?since=<last message id, or 10m on first start>`,
  a stream of newline-delimited JSON. Use lines with `"event":"message"`; the wire string is in `"message"`.
  Remember the last ntfy `"id"` to resume. Reconnect with backoff (2s → 60s).
- Ignore envelopes whose `from` is yourself, and ones you can't decrypt.

## Types
| t | fields | what the receiver does |
|---|---|---|
| `hello` | – | Reply with `state`. Sent by each side when it connects. |
| `state` | `sched` | The shared day (below). Apply it if `sched.editedAt` is newer than your own. Never re-broadcast what you just applied. |
| `clip` | `text` (≤2000 chars) | Put it on the clipboard and show a small "Copied from your phone/PC" notice. |
| `open` | `url` | Open the link (phone: in the browser; PC: default browser). |
| `bible` | `book` (0-based, KJV order, 0 = Genesis … 65 = Revelation), `chapter` (1-based) | Open the Bible at that chapter. |
| `note` | `text` | Show it as a notice. |

`sched`:
```json
{
  "blocks": [{"title": "Time with God", "preset": "god", "len": 30}, ...],
  "defaultWake": 360,
  "wakeAt": 1793520000000,
  "prevWakeAt": 0,
  "names": {"god": "Time with God", "strict": "Strict", "work": "Work", "normal": "Normal", "free": "Free time"},
  "editedAt": 1793520000000
}
```
- Preset ids are fixed: `god`, `strict`, `work`, `normal`, `free`.
- Blocks run back to back from the day's anchor: `wakeAt` if it was tapped within the length of the day
  (and no more than 6 h before today's usual wake time), otherwise the usual wake time (`defaultWake`,
  minutes after midnight). Offsets are counted on the wall clock so daylight saving doesn't shift the day.
  After the last block it's open time (`normal`) until the next usual wake time.
- What each preset allows is per device (Android apps vs Windows programs and websites) and does not sync.
