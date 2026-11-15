# Audenic V1 ✦
### Lossless local music, reels & an AI studio — for Android

**Made by Mwijay.**

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
| `build_audenic.py` | Builds, signs and **verifies** the APK (`--doctor`, `--verify`, `--fetch-tools`) |
| `build_audenic.bat` | Windows one-click wrapper — same script, no hardcoded paths |
| `.github/workflows/build-apk.yml` | Manual cloud build: source APK in, verified artifact out |
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

**Made by Mwijay.** One command turns this repo into a signed `Audenic.apk`:

```bash
python build_audenic.py            # build → sign → verify → copy Audenic.apk
```

It needs JDK 17+, Python 3.10+, and the source APK. Not sure what you have?

```bash
python build_audenic.py --doctor         # resolved paths, what is missing
python build_audenic.py --fetch-tools    # downloads uber-apk-signer 1.3.0
```

If the download is blocked (offline, restricted network), fetch
`uber-apk-signer-1.3.0.jar` from its GitHub release and either drop it in
`tools/` or point `AUDENIC_SIGNER` at it.

On Windows, double-click **`build_audenic.bat`** — a thin wrapper around the same
script, so there is exactly one build path. Drag an `.apk` onto it to check
whether that APK carries the current Studio.

### A stale Studio can no longer ship

The build hashes every Studio file (25 — tests and docs are excluded), packages them, then re-reads
`assets/transfer_web/index.html` **out of the APK** and compares it with the
repo. A single changed byte aborts the build *before* signing:

```
[3b/5] Verifying the Studio inside the packaged APK...
[verify] unsigned APK: …/audenic_unsigned.apk
         studio files : 25 expected, 25 found
         index.html   : 029a05c3e11e9058 (repo 029a05c3e11e9058)
         result       : OK — APK ships the current Studio
```

The signed artifact is verified again and printed with its SHA-256. Audit an APK
you already have:

```bash
python build_audenic.py --verify Audenic.apk
```

`0` = current Studio · `1` = stale or incomplete · `3` = the build aborted.

`--no-sign` packages and verifies without signing — use it when you sign with
your own keystore or on a different machine.

### Paths

| Variable | Default | What it points at |
| --- | --- | --- |
| `AUDENIC_ROOT` | this repo (or `Desktop\LARK`) | working root for the build |
| `AUDENIC_SOURCE_APK` | `<root>/Lark_Player.zip` | APK being re-skinned |
| `AUDENIC_WEB_DIR` | **`./assets/transfer_web`** | the Studio that gets embedded |
| `AUDENIC_DEX_DIR` | `<root>/dex_out` | patched `classes4/5.dex` |
| `AUDENIC_OUT` | `<root>/dist` | signed output |
| `AUDENIC_JAVA`, `AUDENIC_SIGNER` | auto-detected | JDK, signer jar |

`AUDENIC_WEB_DIR` defaults to **this repo's** `assets/transfer_web`, so a rebuild
cannot pick up a stale copy from a Desktop folder.

### Build in the cloud (no local JDK)

`.github/workflows/build-apk.yml` is a manual workflow: give it a direct download
URL for a source APK (your current `Audenic.apk`, or `Lark_Player.zip`) and it
builds, verifies and uploads `audenic-apk` as a run artifact with a
`SHA256SUMS.txt`. Launcher and notification art come from the source APK you
provide, so pass a build that already carries the Audenic branding if you want
it kept.

The build patches 1,600+ ARSC strings, the nav labels, launcher/splash
drawables, notification icons, the header Lottie, `classes4.dex`/`classes5.dex`,
and every file under `assets/transfer_web/`, then zip-aligns and signs v2.

---

## Tests

```bash
node assets/transfer_web/core.test.mjs     # 22 checks — parsing, exports, branding
python3 tests/build_verify_test.py         # 6 checks — the APK/Studio guard
python -m py_compile gemini_companion.py build_audenic.py
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

**Made by Mwijay.**

Personal rebuild of a native player, for high-fidelity local audio.
AI inference by Google Gemini and Groq. Rebranding work packaged with apktool and
uber-apk-signer.
