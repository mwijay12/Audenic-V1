# Audenic AI Studio — `assets/transfer_web`

The Studio is the screen that opens from **Settings → ✦ Audenic AI Studio** inside
the Audenic APK. It is a single self-contained HTML file: no build step, no CDN,
no framework, and it renders identically inside an Android WebView and a desktop
browser.

```
assets/transfer_web/
├── index.html        ← the Studio (markup + CSS + core + UI, ~3.4k lines)
├── core.test.mjs     ← zero-dependency tests for the pure helpers
├── img/, icon/       ← assets still used by the original transfer screens
├── app.css app.js render.js queue.js log.js api.js
│                     ← legacy Lark transfer UI, NOT loaded by the Studio
└── gemini.js         ← legacy standalone AI client, NOT loaded by the Studio
```

> The legacy files are kept because other native screens may still request them
> from the APK's asset bundle. `index.html` does not reference them; delete only
> after checking the decompiled tree.

---

## What it does

| Tab | Output | Why it exists |
| --- | --- | --- |
| **Lyrics** | `.lrc` with `[mm:ss.xx]` timestamps | Sync lyrics in Audenic's karaoke view |
| **Curator** | Ordered setlist → `.m3u` | Turn a mood or occasion into a playable set |
| **Acoustic EQ** | Five gains + DSP extras | Match the native 5-band equaliser to a record |
| **Engine** | Keys, provider, diagnostics | Connect Gemini/Groq and prove it works |

Every result shows **which engine answered, which model, how long it took and
whether it came from the companion or a device key**. Nothing is invented: if the
engine fails, you get an error with a retry and a link to Engine. Sample output
exists, but it is explicitly labelled *Sample*.

---

## Engine order

```
companion /api/ai/generate   (preferred: keys never enter the page)
        │  not running?
        ▼
Gemini 3.8 Flash  →  Gemini 3.6 Flash  →  Groq GPT-OSS 120B  →  Qwen 3.8 27B
```

- **Companion** — `python gemini_companion.py --serve`. The page calls
  `POST /api/ai/generate`; key selection, retries and the provider fallback all
  happen server-side. This is the only route that keeps secrets out of the page.
- **Device key** — paste a key in **Engine**. Stored in `localStorage` on that
  device only, sent directly to the provider. Convenient, but anyone who can
  unlock the phone can read it.
- **Preferred engine** can be pinned to Gemini or Groq, or left on Automatic.

The Engine tab's **Run connection test** sends one tiny prompt and reports the
real route, model, latency and reply. It never claims success it did not observe.

---

## Companion API

| Method | Path | Body / notes |
| --- | --- | --- |
| `GET` | `/api/health` | `{ok, version, uptimeSec, models, vault:{gemini,groq}, env}` |
| `GET` | `/api/vault` | Masked key presence only — raw secrets never leave the machine |
| `POST` | `/api/ai/generate` | `{prompt, system, json?, provider?, maxTokens?}` → `{text, provider, model, latencyMs}` |
| `POST` | `/api/gemini/generate` | Legacy alias of the above |
| `GET` | `/` | Serves `index.html` |
| `GET` | `/assets/...` | Serves files from this directory only |

`/api/ai/generate` returns **502** with `{error, provider, status}` when no
provider is configured or every attempt fails; the UI turns that into a readable
message rather than a silent failure.

The server sends `Access-Control-Allow-Origin: *`, which is required because the
APK loads the page from `file://` — an opaque origin. It binds to `127.0.0.1` by
default and serves **only this directory**, so the project tree and
`ai_vault_local.json` are never exposed.

---

## Configuration

Keys, in priority order:

1. Request override (CLI `--key` / `--groq-key`, or `geminiKey`/`groqKey` in a POST body)
2. Environment: `GEMINI_API_KEY`, `GROQ_API_KEY`
3. Untracked `ai_vault_local.json` next to `gemini_companion.py`:

```json
{ "gemini_keys": ["..."], "groq_keys": ["..."] }
```

Multiple keys are rotated automatically. A `401` retires the key for that request;
a `429` moves to the next key, then the next model, then the next provider.

---

## Running it

```bash
# Served (recommended) — opens on http://127.0.0.1:8080/
python gemini_companion.py --serve

# Reachable from another device on your LAN (proxy only, keys stay local)
python gemini_companion.py --serve --host 0.0.0.0

# Or just open the file directly; it falls back to device keys
xdg-open assets/transfer_web/index.html
```

On a phone, the Studio is loaded from `file:///android_asset/transfer_web/index.html`.
For the companion probe to work there, the WebView must allow cleartext HTTP to
`127.0.0.1` (`android:usesCleartextTraffic="true"` or a network-security config).
Without it, use a device key instead — the UI falls back automatically.

---

## Design and accessibility notes

- **One surface system.** No nested cards; hierarchy comes from three luminance
  steps (`#0d0f16` → `#12151f` → `#181c28`) and hairline borders.
- **Logical properties only** (`inset-inline`, `padding-inline`) so Arabic locales
  mirror without a second stylesheet.
- **Keyboard**: tabs use arrow keys, EQ bands are `role="slider"` (↑ ↓, Home/End,
  `0` resets), the lyric scrubber supports arrows/Space. Focus is always visible.
- **Touch**: 44 px minimum targets, `touch-action: none` on the sliders, haptics
  where supported.
- **Reduced motion** and **prefers-contrast** are both honoured.
- **No `alert()`**; toasts plus an `aria-live` region announce results.
- **Safe areas**: `env(safe-area-inset-*)`, with extra header clearance when the
  page is loaded from `file://` on a device.

---

## Tests

```bash
node assets/transfer_web/core.test.mjs
```

19 checks over the parsing layer: LRC timestamps (fraction, offset, multi-tag),
JSON extraction from fenced/wrapped replies, curator normalisation, EQ key
aliases and clamping, and `.m3u` export. The UI layer is exercised separately by
loading `index.html` in a DOM (tabs, karaoke seek, presets, key state, proxy
routing, error states).

If you change a prompt or a parsing rule, change the test first — those are the
parts that break silently.
