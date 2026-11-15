# Audenic — Change Log

---

## v2 — Studio quality pass · 12 November 2026

A deep review of the AI Studio and its companion server. The previous UI looked
finished but four defects meant the key features could not work as advertised.
Those are fixed first, then the interface was rebuilt around them.

### Bugs fixed

| # | Defect | Effect | Fix |
| --- | --- | --- | --- |
| 1 | Client read `data.groq_key`; server returned `{gemini_keys, groq_keys}` | The vault lookup always failed — the Studio never picked up a key | Client now uses the documented shape; `/api/vault` returns counts and masked values |
| 2 | No CORS headers on the companion | A page loaded from `file://` has an opaque origin, so every `fetch` to `127.0.0.1:8080` was blocked | `Access-Control-Allow-Origin: *`, methods/headers, `OPTIONS` 204 |
| 3 | `socketserver.TCPServer` (single-threaded) | One slow generation froze the whole UI, including health checks and static files | `ThreadingMixIn` + `daemon_threads` + `allow_reuse_address` |
| 4 | `SimpleHTTPRequestHandler` served the **project root** | `ai_vault_local.json`, source and dex were fetchable over HTTP | Static serving is sandboxed to `assets/transfer_web` with traversal checks |
| 5 | `requestLyrics()` swallowed errors | On any failure it displayed **hard-coded placeholder lyrics as real output** | Removed; failures now surface a readable error with retry |
| 6 | Gemini path used `client.interactions.create` | That method does not exist in `google-genai`; the branch silently fell through | REST-only via stdlib `urllib`, with model fallback |
| 7 | Groq default was `llama-3.3-70b-versatile` | Groq has been migrating keys off LLaMA 3.3; new keys get 404s | Primary `openai/gpt-oss-120b`, then `qwen/qwen3.8-27b`, LLaMA as legacy |
| 8 | `/api/gemini/generate` called Gemini directly | No Groq fallback despite the docs advertising it | Routed through the shared `generate()` chain |
| 9 | `/api/vault` returned raw keys to any caller | A LAN client could read every secret | Masked output only; generation is proxied instead |
| 10 | `alert()` / `document.execCommand` brittle copy | Jarring dialogs in a WebView; copy failed on `file://` | Toast system + clipboard fallback; no dialogs |

### The Studio, rebuilt

A single dependency-free file (`assets/transfer_web/index.html`, ~3.4k lines).

**Interface**

- One OLED surface system with three luminance steps; no nested bordered cards.
- Aurora light field, hairline borders, one easing curve, 160–420 ms motion.
- Tab-specific microcopy and outcome-oriented labels; nothing claims more than it does.
- Persistent header chip showing real engine state: *Checking / Vault linked / Device key / No key*.

**Function**

- **Lyrics** — LRC parser (fractions, offsets, multiple tags per line) plus a live
  karaoke preview: active-line glow, neighbour blur, tap-to-seek, scrubber,
  keyboard seeking, line count, and `.lrc` export.
- **Curator** — JSON setlist normalisation into track cards with BPM, duration and
  per-track reasoning; prose replies still render; `.m3u` export with real durations.
- **EQ** — draggable, keyboard-operable band sliders with a 0 dB baseline,
  positive/negative colouring, five presets, AI gains sent as a *delta from your
  current curve*, and optional DSP extras.
- **Engine** — provider preference, per-provider device keys with saved-state
  indicators, companion health, and a genuinely observed connection test.

**Honesty**

- No fabricated results: failures show error + retry + a route to Engine.
- Sample output exists but is labelled *Sample — no request was sent*.
- Every result reports engine, model, latency and route.

**Accessibility**

- `tablist`/`tab`/`tabpanel` with `aria-selected`, roving `tabindex`, arrow/Home/End keys.
- EQ bands are `role="slider"` with `aria-valuenow`/`aria-valuetext` and keyboard control.
- Visible `:focus-visible` rings; 44 px targets; `aria-live` announcer; labelled icon buttons.
- `prefers-reduced-motion` and `prefers-contrast` honoured.
- Removed `user-scalable=no` from the viewport; `color-scheme: dark`; text contrast raised to ≥ 4.5:1.

**Layout**

- Mobile-first, 320 px → desktop; max-width 780 px, no stretched cards on large screens.
- Safe-area insets via `env()`, with extra header clearance on `file://` (device WebView).
- Logical properties throughout, so RTL mirrors correctly.

### Companion server

- Threaded, CORS-correct, `Cache-Control: no-store` on API routes, `nosniff`.
- `GET /api/health`, `GET /api/vault` (masked), `POST /api/ai/generate`, legacy alias.
- Binds to `127.0.0.1` by default with a printed warning when it does not.
- Multiple keys rotate on `401`/`429`; `/api/ai/generate` reports the provider's
  real failure instead of a generic 500.
- CLI: `--host`, `--provider`, `--groq-key`, `--version`; friendly errors instead
  of tracebacks; `"Artist - Title"` parsing fixed for titles containing hyphens.

### Build and tests

- `build_audenic.py` no longer hardcodes one Windows profile: paths come from
  `AUDENIC_ROOT`, `AUDENIC_SOURCE_APK`, `AUDENIC_WEB_DIR`, `AUDENIC_OUT`,
  `AUDENIC_JAVA`, `AUDENIC_SIGNER`, with a readable preflight checklist.
- `AUDENIC_WEB_DIR` defaults to this repo, so a rebuild always ships the current Studio.
- `node assets/transfer_web/core.test.mjs` — 19 checks over LRC parsing, JSON
  extraction, curator/EQ normalisation and `.m3u` export.
- UI smoke-tested in a DOM: 17 checks across tabs, karaoke seeking, presets,
  key state, proxy routing and error notices.

### Documentation

`README.md`, `GEMINI_FEATURE.md` and `assets/transfer_web/README.md` rewritten to
match behaviour — model IDs, fallback order, the companion API, the security
model, and the exact test commands.

---

## v1 — initial rebrand · 11 November 2026

### Branding

- Replaced the Lark mascot and animated wordmark with vector **AUDENIC✦**
  typography (tracked uppercase, cyan spark) and an "A" soundwave emblem.
- Patched **1,600+ ARSC strings**, including all localised "Lark Player" variants.
- New adaptive launcher foreground/background, splash logo, and all five mipmap
  densities for square and round icons.
- Nav labels remapped: Home · Explore · Library · Reels · Settings (+ AI Studio).

### Native patches

- Dalvik verifier widening in `MainContentFragment.smali` (cleared `VerifyError`).
- `setAllowFileAccess(true)` / `setAllowFileAccessFromFileURLs(true)` and skipped
  query-param appending for `file:///android_asset/` URLs.
- Settings entry rewired to open the bundled Studio.

### AI Studio v1

- First embedded AI screen inside the app's WebView, with lyrics, curation, EQ and
  a vault tab.
- Groq-based generation with a Gemini fallback chain.
- **Superseded by v2** — note that v1's vault lookup, CORS, threading and error
  handling were broken in ways described above.

### Known constraints

- No APK is built in this repository; the source APK and decoded tree are
  untracked and live on the build machine.
- The Studio's companion needs cleartext HTTP to `127.0.0.1` inside the WebView,
  or a device key.
- `app.css`, `app.js`, `render.js`, `queue.js`, `log.js`, `api.js` and `gemini.js`
  in `assets/transfer_web/` belong to the legacy Lark transfer screens and are not
  loaded by the Studio. They are kept so native screens that request them keep working.
