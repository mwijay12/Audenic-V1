# Audenic V1 ✦
### Lossless local music, reels & an AI studio — for Android

Audenic is a rebranded, re-engineered build of a native Android player: local
media indexing, a native audio pipeline, vertical video reels, and an embedded
**Audenic AI Studio** that runs inside the app's own WebView.

The app core stays native. The AI is an additive layer reached from
**Settings → ✦ Audenic AI Studio** — it never interrupts playback.

---

## What is in this repository

This repo holds the parts that can be versioned and reviewed safely:

| Path | What it is |
| --- | --- |
| `assets/transfer_web/index.html` | **The AI Studio** — one self-contained, dependency-free page |
| `assets/transfer_web/core.test.mjs` | Tests for the Studio's parsing layer (`node …`) |
| `gemini_companion.py` | CLI + local companion server (Gemini → Groq, JSON API) |
| `build_audenic.py` | Repackages the decoded tree into a signed APK |
| `build_audenic.bat` | Windows one-shot apktool → align → sign |
| `dex_out/classes4.dex`, `classes5.dex` | Patched dex files (launcher + chat UI) |
| `patch_*.py`, `find_*.py`, `read_*.py` | One-off smali/ARSC inspection scripts from the port |
| `drive.v3.json`, `*.proto`, `*.properties` | Artifacts that were already in the APK |

The **decoded APK tree, the source APK and the signed builds are not tracked**
(see `.gitignore`). Builds happen on the machine that holds them; this repo is
the source of truth for the Studio and the tooling.

---

## Quick start

### The Studio, in a browser

```bash
python gemini_companion.py --serve
# open http://127.0.0.1:8080/
```

No key yet? Every tab has a **"Preview sample output"** link that renders a
clearly-labelled example, so the interface can be reviewed offline.

### The Studio, inside the app

It is already bundled and wired: `Settings → ✦ Audenic AI Studio` loads
`file:///android_asset/transfer_web/index.html`. Add a key in the **Engine** tab,
or run the companion on the same machine/network and press **Recheck**.

### The CLI

```bash
python gemini_companion.py --lrc      "Solomon Mkubwa - Mungu Mwenye Nguvu" --lang Swahili
python gemini_companion.py --tag      "yt1s.com - Burna_Boy_City_Boys_Official_Video.mp3"
python gemini_companion.py --playlist "Sunday morning bongo worship" --out sunday.m3u
python gemini_companion.py --dj       "Rema - Calm Down"
python gemini_companion.py --eq       "Afrobeats"
python gemini_companion.py --batch-lrc ./my_music
```

---

## ✦ The AI Studio

Four tabs, one design system, and an honest engine status chip in the header.

1. **Lyrics** — generates `.lrc` lines with `[mm:ss.xx]` timestamps, then lets you
   *preview the timing*: a karaoke strip with depth-of-field highlighting, a
   scrubber, tap-to-seek, and one-click `.lrc` export. If you already have the
   words, paste them and the engine only has to time them.
2. **Curator** — describe a mood, occasion or scripture and get an ordered
   setlist with a reason per track, exported as `.m3u` (durations parsed into
   `#EXTINF`).
3. **Acoustic EQ** — the five bands Audenic's native equaliser exposes (60 Hz,
   230 Hz, 910 Hz, 3.6 kHz, 14 kHz). Drag, or let the engine propose gains for a
   described sound; the response also carries bass boost, 3D width and a reverb
   space when the model provides them.
4. **Engine** — provider choice, device keys, companion status, and a real
   connection test that reports the model, route, latency and reply.

Design and implementation notes live in
[`assets/transfer_web/README.md`](assets/transfer_web/README.md).

---

## Engine and keys

```
companion proxy  →  Gemini 3.8 Flash  →  Gemini 3.6 Flash
                 →  Groq GPT-OSS 120B →  Qwen 3.8 27B →  LLaMA 3.3 70B (legacy)
```

- The **companion** is the private route: keys stay on the machine, the page only
  sees `{text, provider, model, latencyMs}`.
- **Device keys** are stored in `localStorage`, sent straight to the provider, and
  never bundled in the APK. They are readable by anyone who unlocks the phone —
  fine for a personal build, not for a shared device.
- `/api/vault` reports **masked** key presence only.
- Keys resolve from a request override, then `GEMINI_API_KEY` / `GROQ_API_KEY`,
  then an untracked `ai_vault_local.json`. Multiple keys rotate on `401`/`429`.

No credential is compiled into the application binary.

### Gemini API notes

`gemini-3.8-flash` and `gemini-3.6-flash` are called over
`v1beta/models/{model}:generateContent`. The previous `google-genai` SDK branch
used `client.interactions.create`, which does not exist in that SDK and silently
failed; the companion now uses the REST endpoint only, with stdlib `urllib`.

---

## Companion HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, version, configured models, vault counts |
| `GET` | `/api/vault` | Masked key presence |
| `POST` | `/api/ai/generate` | `{prompt, system?, json?, provider?, maxTokens?}` |
| `POST` | `/api/gemini/generate` | Legacy alias |
| `GET` | `/` | The Studio |

The server is threaded (a slow lyric generation no longer blocks the UI), sends
CORS headers (`file://` pages have an opaque origin), binds to `127.0.0.1` by
default, and serves **only** `assets/transfer_web` with traversal checks.

---

## Build

Prerequisites: JDK 21, Python 3.10+, apktool, uber-apk-signer, the source
`Lark_Player.zip`, and the decoded tree in `work/decoded/`.

```bash
python build_audenic.py          # or: build_audenic.bat
```

Paths are configurable instead of hardcoded:

```bash
AUDENIC_SOURCE_APK=/path/Lark_Player.zip \
AUDENIC_WEB_DIR=$PWD/assets/transfer_web \
AUDENIC_OUT=$PWD/dist \
python build_audenic.py
```

`AUDENIC_WEB_DIR` defaults to **this repo's** `assets/transfer_web`, so a rebuild
cannot ship a stale Studio from a Desktop folder. The script fails with a
readable checklist if the source APK, signer or JDK is missing.

The build patches 1,600+ ARSC strings, the five nav labels, launcher/splash
drawables, notification icons, the header Lottie, `classes4.dex`/`classes5.dex`,
and every file under `assets/transfer_web/`, then zip-aligns and signs v2.

---

## Tests

```bash
node assets/transfer_web/core.test.mjs     # 19 checks
python -m py_compile gemini_companion.py
```

The Studio's parsing layer (LRC timestamps, JSON extraction from wrapped model
replies, curator/EQ normalisation, `.m3u` export) is covered. The UI layer was
smoke-tested in a DOM: tabs, karaoke seeking, presets, key state, proxy routing
and error notices.

---

## ✦ Reverse-engineering notes

1. **Dalvik verifier widening** (`MainContentFragment.smali`) — `field public
   b:Lcom/dywx/v4/gui/base/BaseLazyFragment;` widened to `BaseFragment` to clear a
   `VerifyError` across fragment lifecycles.
2. **Asset scheme normalisation** (`WebViewActivity.smali`,
   `BuildinHybridImpl.smali`) — file access enabled and query-parameter appending
   skipped for `file:///android_asset/` URLs, so the bundled Studio loads cleanly.
3. **Settings navigation** (`SettingsFragment.smali`) — the former
   `remove_ads_layout` handler now launches `WebViewActivity` at
   `file:///android_asset/transfer_web/index.html`.

---

## Security posture

- No keys in the binary; the vault file is git-ignored.
- `/api/vault` never returns raw secrets; static serving is sandboxed.
- Device keys live in `localStorage` — documented in the UI, not hidden.
- `--host 0.0.0.0` prints a warning: it exposes the proxy, not the keys.
- Cleartext HTTP to `127.0.0.1` is required for the companion inside the WebView.
  Prefer a device key if you have not configured cleartext.

## License & credits

Personal rebuild of a native player, for high-fidelity local audio.
AI inference by Google Gemini and Groq. Rebranding work packaged with apktool and
uber-apk-signer.
