# Audenic AI — Features, Engine and Keys

Audenic's AI layer is deliberately thin: prompts and parsing on one side, a
provider fallback chain on the other, and a UI that tells you what actually
happened. Nothing about it is required for playback.

---

## Engine chain

```
Local companion (proxy)  →  Gemini 3.8 Flash  →  Gemini 3.6 Flash
                         →  Groq GPT-OSS 120B →   Qwen 3.8 27B →  LLaMA 3.3 70B*
```

\* kept only as a legacy fallback; Groq has been steering new keys to
`openai/gpt-oss-120b` and `qwen/qwen3.8-27b`.

- **Gemini** — `v1beta/models/{model}:generateContent`, system instruction plus
  `responseMimeType: application/json` for structured replies.
- **Groq** — OpenAI-compatible `/chat/completions`, `response_format: json_object`.
- **Rotation** — a `401` retires the key for that request; `429`/`404` moves to the
  next model, then to the next provider. Every reply records provider, model and
  latency, and the UI displays them.

---

## The four Studio modules

### 1. Synchronized lyrics (`.lrc`)

Generates `[mm:ss.xx]` lines with header tags and a realistic cadence. Rules the
prompt enforces:

- whole song, not an excerpt;
- instrumental intro 8–18 s, verse lines 3–5 s, chorus ≈ 4 s per line;
- **if the words are unknown, emit cue lines like `[00:12.00] (Verse 1)` instead
  of inventing lyrics** — a hallucinated lyric sheet is worse than an honest cue.

The Studio then parses the reply and gives you a **live timing preview**: the
karaoke strip highlights the active line, dims and blurs its neighbours, follows
scroll position, and lets you tap any line or scrub to seek. Export is `.lrc`.

### 2. Playlist & mood curator

Returns a JSON setlist — title, one-line arc, and tracks with artist, genre, BPM,
duration and a reason for inclusion — rendered as an ordered list and exported as
`.m3u` with correct `#EXTINF` durations. The prompt explicitly forbids inventing
artists or songs.

### 3. Acoustic equalizer

Targets Audenic's five native bands: **60 Hz, 230 Hz, 910 Hz, 3.6 kHz, 14 kHz**,
−10…+10 dB, plus optional bass boost, 3D width and reverb space. The current curve
is sent with the request so “make it warmer” means *relative to what you hear
now*. The reply is normalised (any of `bands`, `eqBandsDb`, `Hz`-suffixed keys or
an array form) and applied to the chart.

### 4. Engine

Provider preference, device keys, companion status, and a connection test that
sends one tiny prompt and prints the real model, route, latency and reply — or a
specific error (`401` key rejected, `429` rate limit, `404` model missing, network).

---

## CLI

```bash
python gemini_companion.py --serve --port 8080
python gemini_companion.py --lrc "The Weeknd - Blinding Lights" --lang Swahili
python gemini_companion.py --tag "yt1s.com - Burna_Boy_City_Boys_Official_Video.mp3"
python gemini_companion.py --playlist "East African bongo flava midnight drive" --out bongo.m3u
python gemini_companion.py --dj "Rema - Calm Down"
python gemini_companion.py --eq "Afrobeats"
python gemini_companion.py --batch-lrc ./my_music
```

`--provider auto|gemini|groq` pins the engine; `--key` / `--groq-key` override keys
for one run.

The CLI and the Studio share the same prompts, so output is consistent — the
Studio just renders it (karaoke preview, track cards, EQ chart) instead of
printing it.

---

## Keys and security

Resolution order for each provider:

1. request override (`--key`, `--groq-key`, or `geminiKey`/`groqKey` in a POST body)
2. `GEMINI_API_KEY` / `GROQ_API_KEY`
3. untracked `ai_vault_local.json` — `{"gemini_keys": [...], "groq_keys": [...]}`

Multiple keys rotate automatically.

- **No key is compiled into the APK.** The Studio reads a device key from
  `localStorage`, or better, calls the companion so the key never enters the page.
- `/api/vault` returns masked values and counts only.
- The companion binds to `127.0.0.1` and serves only `assets/transfer_web`.
- Device keys are readable by anyone with the unlocked phone; the UI says so.

## Honesty rules the UI enforces

- A failed generation shows an error with **Try again** and **Open Engine** —
  never placeholder lyrics dressed up as a result.
- Sample output is labelled *Sample* and states that no request was sent.
- The status chip only says *Vault linked* / *Device key* when that is true;
  *No key* otherwise.
