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
- Compress before encrypting: the bytes that get encrypted are `0x01` followed by the zlib (RFC 1950)
  deflate of the UTF-8 JSON. On receipt, if the decrypted bytes start with `0x01`, inflate the rest;
  otherwise read them as plain UTF-8 JSON. A whole week compresses to about 2.4 KB.
- Encrypt with AES-256-GCM, a random 12-byte IV, 128-bit tag.
  Wire string = base64 (standard, no line breaks) of `IV || ciphertext || tag`
  (this is exactly what Java's `Cipher.doFinal` output appended to the IV gives you).
- Keep the wire string under 4000 bytes (ntfy's limit): the compressed bytes under ~2900. Don't send anything bigger.
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

`sched` (version 2, a week of clock-time blocks):
```json
{
  "v": 2,
  "days": {
    "sun": [{"start": "07:00", "end": "07:15", "title": "Wake up and get light", "preset": "strict", "note": "Water, step outside."}, ...],
    "mon": [...], "tue": [...], "wed": [...], "thu": [...], "fri": [...], "sat": [...]
  },
  "names": {"god": "Time with God", "strict": "Strict", "work": "Work", "normal": "Normal", "free": "Free time"},
  "editedAt": 1793520000000
}
```
- The starting week is `shared/week.json` in this repo. Both apps ship it as their default.
- Preset ids are fixed: `god`, `strict`, `work`, `normal`, `free`.
- `start`/`end` are 24-hour local wall-clock times. If `end` is not after `start`, the block runs past midnight
  into the next day (Sleep, 22:30 → 06:30).
- What's on now: lay out yesterday's, today's and tomorrow's blocks on the wall clock (local time zone, so daylight
  saving never shifts them) and take the block with start ≤ now < end; if two match, the later start wins.
  If none matches, it's open time (`normal`, title "Open time") until the next block starts.
- `note` is the "what to do" line shown under the block title.
- A receiver ignores a `state` whose `sched.v` is not 2 (older phones/PCs send the old one-day format).
- What each preset allows is per device (Android apps vs Windows programs and websites) and does not sync.
