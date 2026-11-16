#!/usr/bin/env python3
"""
Audenic — AI Music & Audio Companion

A small CLI and local web server that powers the Audenic AI Studio WebView and
gives you the same tools from a terminal.

Engine order
------------
Google Gemini 2.5 Flash (``gemini-2.5-flash``) first, then Groq
(``llama-3.3-70b-versatile``) as a fallback. Model IDs, provider choice and keys are
resolved at runtime; nothing is compiled into the APK.

Usage
-----
  # Web Studio + JSON API on http://127.0.0.1:8080
  py gemini_companion.py --serve

  # Lyrics, metadata, playlists, DJ intros, EQ advice
  py gemini_companion.py --lrc "The Weeknd - Blinding Lights"
  py gemini_companion.py --lrc "Solomon Mkubwa - Mungu Mwenye Nguvu" --lang Swahili
  py gemini_companion.py --tag "yt1s.com - Burna_Boy_City_Boys_Official_Video.mp3"
  py gemini_companion.py --playlist "Late night chill lo-fi study beats" --out study.m3u
  py gemini_companion.py --dj "Rema - Calm Down"
  py gemini_companion.py --eq "Afrobeats"
  py gemini_companion.py --batch-lrc ./my_music_folder

Keys
----
Set ``GEMINI_API_KEY`` / ``GROQ_API_KEY`` in the environment, pass ``--key`` /
``--groq-key``, or drop an untracked ``ai_vault_local.json`` next to this file:

  {"gemini_keys": ["..."], "groq_keys": ["..."]}

Security
--------
The server binds to 127.0.0.1 by default and only serves the ``transfer_web``
asset directory — never the project tree. ``/api/vault`` returns masked key
presence, never raw secrets. Binding to 0.0.0.0 exposes the generation proxy
(not the keys) to your network; only do it on a network you trust.
"""

from __future__ import annotations

import argparse
import http.server
import json
import os
import re
import socketserver
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

APP_NAME = "Audenic AI Studio"
VERSION = "2.0"

GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]
GROQ_MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"]

GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions"

WORKSPACE = Path(__file__).resolve().parent
WEB_DIR = WORKSPACE / "assets" / "transfer_web"
VAULT_FILE = WORKSPACE / "ai_vault_local.json"

STARTED_AT = time.time()
MAX_BODY_BYTES = 1_000_000
MAX_PROMPT_CHARS = 20_000


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class AIProviderError(RuntimeError):
    """A provider or configuration failure with an HTTP-ish status."""

    def __init__(self, status: int, message: str, provider: str = ""):
        super().__init__(message)
        self.status = status
        self.provider = provider


# ---------------------------------------------------------------------------
# Keys and vault
# ---------------------------------------------------------------------------

def _as_key_list(value) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, (list, tuple)):
        return []
    keys = []
    for item in value:
        if isinstance(item, str) and item.strip():
            keys.append(item.strip())
    return keys


def load_vault() -> dict[str, list[str]]:
    """Read the optional local key vault. Returns lists, never raises."""
    vault = {"gemini": [], "groq": []}
    if not VAULT_FILE.exists():
        return vault
    try:
        with open(VAULT_FILE, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception as error:  # malformed file should not kill the server
        print(f"[vault] ignoring {VAULT_FILE.name}: {error}", file=sys.stderr)
        return vault

    if not isinstance(data, dict):
        return vault

    vault["gemini"] = _as_key_list(
        data.get("gemini_keys") if data.get("gemini_keys") is not None else data.get("gemini")
    )
    vault["groq"] = _as_key_list(
        data.get("groq_keys") if data.get("groq_keys") is not None else data.get("groq")
    )
    return vault


def mask_key(key: str) -> str:
    if not key:
        return ""
    if len(key) <= 10:
        return "••••"
    return f"{key[:4]}…{key[-4:]}"


def _keys_for(provider: str, override: str | None = None) -> list[str]:
    keys: list[str] = []
    if override and override.strip():
        keys.append(override.strip())
    env_name = "GEMINI_API_KEY" if provider == "gemini" else "GROQ_API_KEY"
    env_key = os.environ.get(env_name, "").strip()
    if env_key:
        keys.append(env_key)
    keys.extend(load_vault().get(provider, []))

    seen = set()
    unique = []
    for key in keys:
        if key not in seen:
            seen.add(key)
            unique.append(key)
    return unique


def get_api_key(override_key: str | None = None) -> str:
    keys = _keys_for("gemini", override_key)
    return keys[0] if keys else ""


def get_groq_key(override_key: str | None = None) -> str:
    keys = _keys_for("groq", override_key)
    return keys[0] if keys else ""


# ---------------------------------------------------------------------------
# HTTP transport
# ---------------------------------------------------------------------------

def _post_json(url: str, payload: dict, headers: dict, timeout: int = 90) -> dict:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="ignore")
        try:
            message = json.loads(body).get("error", {}).get("message") or body
        except Exception:
            message = body
        raise AIProviderError(error.code, str(message)[:400]) from error
    except urllib.error.URLError as error:
        raise AIProviderError(0, f"Network error: {error.reason}") from error
    except TimeoutError as error:
        raise AIProviderError(0, "The provider timed out.") from error


# ---------------------------------------------------------------------------
# Providers
# ---------------------------------------------------------------------------

def _gemini_generate(
    prompt: str,
    system_instruction: str = "",
    api_key: str | None = None,
    json_mode: bool = False,
    max_tokens: int = 2800,
) -> tuple[str, str]:
    key = (api_key or "").strip()
    if not key:
        raise AIProviderError(0, "A Gemini API key is required.", "gemini")

    payload: dict = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.55, "maxOutputTokens": max_tokens},
    }
    if system_instruction:
        payload["systemInstruction"] = {"parts": [{"text": system_instruction}]}
    if json_mode:
        payload["generationConfig"]["responseMimeType"] = "application/json"

    last_error: AIProviderError | None = None
    for model in GEMINI_MODELS:
        url = GEMINI_ENDPOINT.format(model=model) + "?key=" + urllib.parse.quote(key)
        try:
            data = _post_json(url, payload, {})
            candidates = data.get("candidates") or []
            if not candidates:
                blocked = (data.get("promptFeedback") or {}).get("blockReason")
                raise AIProviderError(0, f"Gemini returned no candidates ({blocked or 'empty'}).", "gemini")
            parts = (candidates[0].get("content") or {}).get("parts") or []
            text = "".join(part.get("text", "") for part in parts).strip()
            if not text:
                raise AIProviderError(0, "Gemini returned an empty answer.", "gemini")
            return text, model
        except AIProviderError as error:
            error.provider = "gemini"
            last_error = error
            if error.status in (404, 429):
                continue
            raise

    assert last_error is not None
    raise last_error


def _groq_generate(
    prompt: str,
    system_instruction: str = "",
    api_key: str | None = None,
    json_mode: bool = False,
    max_tokens: int = 2800,
) -> tuple[str, str]:
    key = (api_key or "").strip()
    if not key:
        raise AIProviderError(0, "A Groq API key is required.", "groq")

    messages = []
    if system_instruction:
        messages.append({"role": "system", "content": system_instruction})
    messages.append({"role": "user", "content": prompt})

    last_error: AIProviderError | None = None
    for model in GROQ_MODELS:
        payload: dict = {
            "model": model,
            "messages": messages,
            "temperature": 0.55,
            "max_tokens": max_tokens,
        }
        if json_mode:
            payload["response_format"] = {"type": "json_object"}
        try:
            data = _post_json(
                GROQ_ENDPOINT, payload, {"Authorization": f"Bearer {key}"}
            )
            choices = data.get("choices") or []
            text = ((choices[0].get("message") or {}).get("content") or "").strip() if choices else ""
            if not text:
                raise AIProviderError(0, "Groq returned an empty answer.", "groq")
            return text, model
        except AIProviderError as error:
            error.provider = "groq"
            last_error = error
            if error.status in (404, 429):
                continue
            raise

    assert last_error is not None
    raise last_error


def call_gemini(
    prompt: str,
    system_instruction: str = "",
    api_key: str | None = None,
    json_mode: bool = False,
    max_tokens: int = 2800,
) -> str:
    """Generate text with Gemini only. Raises AIProviderError on failure."""
    return _gemini_generate(prompt, system_instruction, api_key, json_mode, max_tokens)[0]


def call_groq(
    prompt: str,
    system_instruction: str = "",
    api_key: str | None = None,
    json_mode: bool = False,
    max_tokens: int = 2800,
) -> str:
    """Generate text with Groq only. Raises AIProviderError on failure."""
    return _groq_generate(prompt, system_instruction, api_key, json_mode, max_tokens)[0]


def generate(
    prompt: str,
    system_instruction: str = "",
    prefer: str = "auto",
    json_mode: bool = False,
    gemini_key: str | None = None,
    groq_key: str | None = None,
    max_tokens: int = 2800,
) -> dict:
    """
    Generate text with automatic provider and key rotation.

    Returns {"text", "provider", "model", "latencyMs"}.
    """
    if not prompt or not prompt.strip():
        raise AIProviderError(0, "The prompt is empty.", "")

    prefer = prefer if prefer in ("auto", "gemini", "groq") else "auto"
    order = []
    if prefer in ("auto", "gemini"):
        order.append("gemini")
    if prefer in ("auto", "groq"):
        order.append("groq")

    failures: list[str] = []

    for provider in order:
        override = gemini_key if provider == "gemini" else groq_key
        keys = _keys_for(provider, override)
        if not keys:
            failures.append(f"{provider}: no key configured")
            continue

        for key in keys:
            started = time.perf_counter()
            try:
                if provider == "gemini":
                    text, model = _gemini_generate(prompt, system_instruction, key, json_mode, max_tokens)
                else:
                    text, model = _groq_generate(prompt, system_instruction, key, json_mode, max_tokens)
                return {
                    "text": text,
                    "provider": provider,
                    "model": model,
                    "latencyMs": int((time.perf_counter() - started) * 1000),
                }
            except AIProviderError as error:
                failures.append(f"{provider} {error.status or ''}: {error}".strip())
                if error.status in (401, 403):
                    break  # this key is bad; try the next provider
                continue

    raise AIProviderError(0, "; ".join(failures) or "No AI provider is configured.")


def call_ai(
    prompt: str,
    system_instruction: str = "",
    gemini_key: str | None = None,
    groq_key: str | None = None,
    prefer: str = "auto",
    json_mode: bool = False,
    max_tokens: int = 2800,
) -> str:
    """Convenience wrapper returning just the text."""
    return generate(
        prompt,
        system_instruction,
        prefer=prefer,
        json_mode=json_mode,
        gemini_key=gemini_key,
        groq_key=groq_key,
        max_tokens=max_tokens,
    )["text"]


# ---------------------------------------------------------------------------
# Parsing helpers
# ---------------------------------------------------------------------------

def strip_fences(text: str) -> str:
    text = (text or "").strip()
    text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
    text = re.sub(r"\s*```$", "", text)
    return text.strip()


def json_from_text(text: str) -> dict:
    """Parse the first JSON object in a model reply."""
    clean = strip_fences(text)
    start, end = clean.find("{"), clean.rfind("}")
    if start != -1 and end > start:
        clean = clean[start : end + 1]
    return json.loads(clean)


# ---------------------------------------------------------------------------
# Feature prompts
# ---------------------------------------------------------------------------

LRC_SYSTEM = (
    "You are Audenic's LRC timing engineer. "
    "Reply with valid LRC text only — no markdown, no code fences, no commentary. "
    "Start with [ti:], [ar:], [al:Audenic AI Studio] and [by:Audenic] header tags. "
    "Every lyric line must begin with a [mm:ss.xx] timestamp. "
    "Keep a realistic cadence: instrumental intro 8–18 s, verse lines 3–5 s apart, "
    "chorus about 4 s per line. "
    "If you do not know the exact words, emit cue lines such as "
    '"[00:12.00] (Verse 1)" instead of inventing lyrics.'
)


def generate_lrc(
    song_title: str,
    artist: str = "",
    raw_lyrics: str = "",
    lang: str = "Original",
    api_key: str = None,
    prefer: str = "auto",
) -> str:
    """Generate a precision-timed .lrc file."""
    user_prompt = f"Song: {song_title}\nArtist: {artist or 'unknown'}\n"
    if lang and lang.lower() != "original":
        user_prompt += f"Target language: {lang} (keep the musical cadence)\n"
    if raw_lyrics:
        user_prompt += f"\nReference lyrics:\n{raw_lyrics}\n\nTime these exact lines."
    else:
        user_prompt += "\nProduce a complete, precision-timed LRC file for the whole song."

    result = call_ai(user_prompt, LRC_SYSTEM, gemini_key=api_key, prefer=prefer, max_tokens=3200)
    return strip_fences(result)


def clean_metadata(query: str, api_key: str = None, prefer: str = "auto") -> dict:
    """Normalise a messy filename or title into clean tags."""
    system_prompt = (
        "You are an expert music metadata librarian. "
        "Parse the input (dirty download title, file name, or song query). "
        "Return ONLY a valid JSON object without markdown fences:\n"
        "{\n"
        '  "title": "Clean Song Title",\n'
        '  "artist": "Primary Artist / Featured Artists",\n'
        '  "album": "Album Name or Single",\n'
        '  "genre": "Musical Genre",\n'
        '  "mood": "Upbeat, Chill, Melodic…",\n'
        '  "year": "Release Year",\n'
        '  "cleanFilename": "Artist - Title.mp3",\n'
        '  "summary": "1-2 sentence musical backstory"\n'
        "}"
    )
    result = call_ai(
        f"Clean and parse this song info:\n{query}",
        system_prompt,
        gemini_key=api_key,
        prefer=prefer,
        json_mode=True,
    )
    return json_from_text(result)


CURATOR_SYSTEM = (
    "You are Audenic's musicologist and setlist builder. "
    "Return ONLY a JSON object — no markdown, no code fences, no commentary. "
    'Shape: {"title":"Setlist name","description":"One sentence on the arc",'
    '"tracks":[{"title":"","artist":"","genre":"","bpm":102,"durationSec":215,"why":"one sentence"}]} '
    "Give ordered tracks with no duplicates. Choose real, findable recordings. "
    "Never invent an artist or a song that does not exist."
)


def curate_playlist(
    prompt_text: str, count: int = 10, api_key: str = None, prefer: str = "auto"
) -> dict:
    """Curate a playlist and build .m3u content from it."""
    result = call_ai(
        f"Curate a {count}-track set for: {prompt_text}",
        CURATOR_SYSTEM,
        gemini_key=api_key,
        prefer=prefer,
        json_mode=True,
    )
    data = json_from_text(result)

    title = data.get("playlistTitle") or data.get("title") or "Audenic Playlist"
    tracks = data.get("tracks") or data.get("tracklist") or data.get("songs") or []

    m3u = [f"#EXTM3U", f"#PLAYLIST:{title}", ""]
    if data.get("description"):
        m3u.append("# " + str(data["description"]).replace("\n", " "))
        m3u.append("")
    for track in tracks:
        if not isinstance(track, dict):
            continue
        name = " - ".join(
            part for part in (str(track.get("artist", "")).strip(), str(track.get("title", "")).strip()) if part
        )
        if not name:
            continue
        seconds = track.get("durationSec") or track.get("duration") or -1
        try:
            seconds = int(seconds)
        except (TypeError, ValueError):
            seconds = -1
        m3u.append(f"#EXTINF:{seconds},{name}")
        m3u.append(f"{name}.mp3")
        m3u.append("")

    data["playlistTitle"] = title
    data["m3uContent"] = "\n".join(m3u)
    return data


def generate_dj_intro(
    song_info: str, mood: str = "energetic", api_key: str = None, prefer: str = "auto"
) -> str:
    """Generate a radio DJ voiceover intro."""
    system_prompt = (
        "You are 'DJ Neo', the charismatic resident AI radio host on Audenic. "
        "Deliver a smooth 2-3 sentence radio intro right before the music hits. "
        "Set the tone, hype the artist and vibe, mention 'You're listening to Audenic', "
        "and transition smoothly. No markdown, no backticks, no quotes. "
        "Sound like a live FM broadcast DJ."
    )
    return call_ai(
        f"Write a DJ intro for track: {song_info}. Mood: {mood}",
        system_prompt,
        gemini_key=api_key,
        prefer=prefer,
        max_tokens=400,
    ).strip()


EQ_SYSTEM = (
    "You are an acoustic engineer tuning Audenic's five-band equalizer "
    "(60 Hz, 230 Hz, 910 Hz, 3.6 kHz, 14 kHz). "
    "Return ONLY a JSON object — no markdown, no code fences, no commentary. "
    'Shape: {"bands":{"60":4,"230":2,"910":0,"36k":3,"14k":5},'
    '"bassBoostPct":40,"virtualizerPct":20,"reverbPreset":"MediumRoom",'
    '"reasoning":"two sentences"} '
    "Every gain is an integer between -10 and +10. Keep moves musical; never push every band to an extreme."
)


def recommend_equalizer(genre_or_track: str, api_key: str = None, prefer: str = "auto") -> dict:
    """Recommend a 5-band curve plus DSP extras."""
    result = call_ai(
        f"Equalizer recommendation for: {genre_or_track}",
        EQ_SYSTEM,
        gemini_key=api_key,
        prefer=prefer,
        json_mode=True,
        max_tokens=800,
    )
    return json_from_text(result)


# ---------------------------------------------------------------------------
# HTTP server
# ---------------------------------------------------------------------------

class AudenicHandler(http.server.SimpleHTTPRequestHandler):
    """Static host for assets/transfer_web plus the Studio JSON API."""

    server_version = f"AudenicStudio/{VERSION}"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    # -- plumbing ---------------------------------------------------------

    def end_headers(self):
        # The Studio may be loaded from file:// inside the WebView, which sends
        # an opaque "null" origin. Without these headers every fetch fails.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        super().end_headers()

    def log_message(self, fmt, *args):  # keep the terminal readable
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))

    def send_json(self, data, status=200):
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_error_json(self, status, message):
        self.send_json({"error": message, "status": status}, status=status)

    def _safe_file(self, relative: str):
        try:
            target = (WEB_DIR / relative).resolve()
            target.relative_to(WEB_DIR.resolve())
        except (ValueError, OSError):
            return None
        return target if target.is_file() else None

    def _send_file(self, path: Path):
        try:
            data = path.read_bytes()
        except OSError:
            self.send_error_json(500, "Could not read the asset.")
            return

        suffix = path.suffix.lower()
        mime = {
            ".html": "text/html; charset=utf-8",
            ".js": "application/javascript; charset=utf-8",
            ".css": "text/css; charset=utf-8",
            ".svg": "image/svg+xml",
            ".json": "application/json; charset=utf-8",
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".webp": "image/webp",
            ".ico": "image/x-icon",
            ".woff": "font/woff",
            ".woff2": "font/woff2",
            ".ttf": "font/ttf",
            ".lottie": "application/json",
        }.get(suffix, "application/octet-stream")

        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    # -- routes -----------------------------------------------------------

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        path = urllib.parse.urlparse(self.path).path

        if path == "/api/health":
            vault = load_vault()
            self.send_json(
                {
                    "ok": True,
                    "app": APP_NAME,
                    "version": VERSION,
                    "uptimeSec": int(time.time() - STARTED_AT),
                    "models": {"gemini": GEMINI_MODELS[0], "groq": GROQ_MODELS[0]},
                    "vault": {"gemini": len(vault["gemini"]), "groq": len(vault["groq"])},
                    "env": {
                        "gemini": bool(os.environ.get("GEMINI_API_KEY")),
                        "groq": bool(os.environ.get("GROQ_API_KEY")),
                    },
                }
            )
            return

        if path == "/api/vault":
            # Presence only: raw secrets never leave the machine.
            vault = load_vault()
            self.send_json(
                {
                    "gemini_keys": [mask_key(key) for key in vault["gemini"]],
                    "groq_keys": [mask_key(key) for key in vault["groq"]],
                    "counts": {"gemini": len(vault["gemini"]), "groq": len(vault["groq"])},
                    "has_gemini": bool(vault["gemini"]),
                    "has_groq": bool(vault["groq"]),
                }
            )
            return

        if path == "/api/ping":
            self.send_json({"ok": True, "sender_state": "ok"})
            return

        if path == "/api/config":
            self.send_json(
                {
                    "storage_free_bytes": 1024 * 1024 * 1024 * 64,
                    "max_single_file_bytes": 1024 * 1024 * 1024 * 4,
                    "allowed_extensions": [
                        "mp3", "m4a", "flac", "wav", "aac", "ogg", "lrc", "m3u", "mp4", "mkv",
                    ],
                }
            )
            return

        if path == "/api/reels":
            self.send_json({"ok": True, "reels": []})
            return

        if path in ("/", "/index.html"):
            index = WEB_DIR / "index.html"
            if index.is_file():
                self._send_file(index)
            else:
                self.send_error_json(404, "index.html is missing from assets/transfer_web.")
            return

        if path.startswith("/assets/"):
            target = self._safe_file(path[len("/assets/"):])
            if target:
                self._send_file(target)
            else:
                self.send_error_json(404, "Asset not found.")
            return

        target = self._safe_file(urllib.parse.unquote(path.lstrip("/")))
        if target:
            self._send_file(target)
        else:
            self.send_error_json(404, "Not found.")

    def do_POST(self):
        path = urllib.parse.urlparse(self.path).path

        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length > MAX_BODY_BYTES:
            self.send_error_json(413, "Request body is too large.")
            return

        raw = self.rfile.read(length) if length else b""

        if path in ("/api/ai/generate", "/api/gemini/generate"):
            try:
                payload = json.loads(raw.decode("utf-8") or "{}")
            except Exception:
                self.send_error_json(400, "Body must be JSON.")
                return
            if not isinstance(payload, dict):
                self.send_error_json(400, "Body must be a JSON object.")
                return

            prompt = str(payload.get("prompt") or "").strip()
            if not prompt:
                self.send_error_json(400, "Missing prompt.")
                return
            if len(prompt) > MAX_PROMPT_CHARS:
                self.send_error_json(400, f"Prompt is longer than {MAX_PROMPT_CHARS} characters.")
                return

            system = str(payload.get("system") or payload.get("system_instruction") or "")
            prefer = str(payload.get("provider") or "auto")
            if prefer not in ("auto", "gemini", "groq"):
                prefer = "auto"
            json_mode = bool(payload.get("json"))
            try:
                max_tokens = int(payload.get("maxTokens") or 2800)
            except (TypeError, ValueError):
                max_tokens = 2800
            max_tokens = max(64, min(max_tokens, 8192))

            try:
                result = generate(
                    prompt,
                    system,
                    prefer=prefer,
                    json_mode=json_mode,
                    gemini_key=payload.get("geminiKey") or None,
                    groq_key=payload.get("groqKey") or None,
                    max_tokens=max_tokens,
                )
                self.send_json(result)
            except AIProviderError as error:
                self.send_json(
                    {
                        "error": str(error),
                        "provider": error.provider,
                        "status": error.status,
                    },
                    status=502,
                )
            return

        if path == "/api/batch/start":
            self.send_json({"ok": True, "batch_id": "audenic_batch_001"})
            return

        self.send_error_json(404, "Endpoint not found.")


class AudenicServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def run_server(host: str = "127.0.0.1", port: int = 8080):
    vault = load_vault()
    handler = AudenicHandler
    with AudenicServer((host, port), handler) as httpd:
        shown = "127.0.0.1" if host in ("", "0.0.0.0") else host
        print("\n" + "=" * 58)
        print(f"  {APP_NAME} — companion server v{VERSION}")
        print("=" * 58)
        print(f"  Studio   http://{shown}:{port}/")
        print(f"  Health   http://{shown}:{port}/api/health")
        print(f"  Engine   Gemini {GEMINI_MODELS[0]} → Groq {GROQ_MODELS[0]}")
        print(f"  Keys     env: {'gemini ' if get_api_key() else ''}{'groq ' if get_groq_key() else ''}"
              f"· vault: {len(vault['gemini'])} gemini / {len(vault['groq'])} groq")
        if not get_api_key() and not get_groq_key():
            print("  Note     no key found yet — paste one into the Studio's Engine tab")
        if host in ("", "0.0.0.0"):
            print("  Warning  bound to all interfaces; the generation proxy is reachable on your LAN")
        print("=" * 58)
        print("  Ctrl+C to stop.\n")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down.")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_error(error: Exception) -> int:
    print(f"\n[error] {error}\n", file=sys.stderr)
    return 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description=f"{APP_NAME} — CLI and local companion server",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Examples:\n"
            '  py gemini_companion.py --serve --port 8080\n'
            '  py gemini_companion.py --lrc "The Weeknd - Blinding Lights"\n'
            '  py gemini_companion.py --playlist "Sunday morning bongo worship" --out sunday.m3u\n'
        ),
    )
    parser.add_argument("--serve", action="store_true", help="Start the Studio web server")
    parser.add_argument("--host", default="127.0.0.1", help="Bind address (default 127.0.0.1)")
    parser.add_argument("--port", type=int, default=8080, help="Port (default 8080)")
    parser.add_argument("--lrc", type=str, help="Generate synced LRC for 'Artist - Title'")
    parser.add_argument("--lang", type=str, default="Original", help="Target lyrics language")
    parser.add_argument("--tag", type=str, help="Clean and analyse audio metadata")
    parser.add_argument("--playlist", type=str, help="Curate a playlist from a mood or theme")
    parser.add_argument("--dj", type=str, help="Generate a DJ voiceover intro")
    parser.add_argument("--eq", type=str, help="Recommend a 5-band equalizer preset")
    parser.add_argument("--batch-lrc", type=str, help="Directory of songs to write .lrc files for")
    parser.add_argument("--out", type=str, help="Output file path")
    parser.add_argument("--key", type=str, help="Gemini API key override")
    parser.add_argument("--groq-key", type=str, help="Groq API key override")
    parser.add_argument("--provider", choices=["auto", "gemini", "groq"], default="auto", help="Preferred engine")
    parser.add_argument("--version", action="version", version=f"{APP_NAME} {VERSION}")

    args = parser.parse_args(argv)

    try:
        if args.serve:
            run_server(args.host, args.port)
            return 0

        if args.lrc:
            if " - " in args.lrc:
                artist, title = args.lrc.split(" - ", 1)
            else:
                artist, title = "", args.lrc
            artist, title = artist.strip(), title.strip()
            print(f"Generating synced lyrics for '{title}' — {artist or 'unknown artist'}…")
            lrc = generate_lrc(
                title,
                artist,
                lang=args.lang,
                api_key=args.key,
                prefer=args.provider,
            )
            out_file = args.out or f"{artist + ' - ' if artist else ''}{title}.lrc"
            Path(out_file).write_text(lrc, encoding="utf-8")
            print(f"Saved {out_file}\n")
            print(lrc)
            return 0

        if args.tag:
            print(f"Analysing metadata for: {args.tag}…")
            meta = clean_metadata(args.tag, api_key=args.key, prefer=args.provider)
            print(json.dumps(meta, indent=2, ensure_ascii=False))
            return 0

        if args.playlist:
            print(f"Curating a set for: '{args.playlist}'…")
            playlist = curate_playlist(args.playlist, api_key=args.key, prefer=args.provider)
            out_file = args.out or (
                str(playlist.get("playlistTitle") or "playlist").replace(" ", "_") + ".m3u"
            )
            Path(out_file).write_text(playlist["m3uContent"], encoding="utf-8")
            print(f"Saved {out_file}")
            print(f"Title: {playlist.get('playlistTitle')}")
            if playlist.get("description"):
                print(f"About: {playlist.get('description')}")
            for index, track in enumerate(playlist.get("tracks", []) or [], 1):
                if isinstance(track, dict):
                    print(f"  {index}. {track.get('artist', '')} - {track.get('title', '')}".rstrip(" -"))
            return 0

        if args.dj:
            print(f"Writing a DJ intro for: '{args.dj}'…")
            intro = generate_dj_intro(args.dj, api_key=args.key, prefer=args.provider)
            print("\n" + "=" * 50)
            print("[DJ NEO on AUDENIC RADIO]")
            print(f'"{intro}"')
            print("=" * 50 + "\n")
            return 0

        if args.eq:
            print(f"Calculating a DSP curve for: '{args.eq}'…")
            eq = recommend_equalizer(args.eq, api_key=args.key, prefer=args.provider)
            print(json.dumps(eq, indent=2, ensure_ascii=False))
            bands = eq.get("bands") or eq.get("eqBandsDb") or {}
            print("\n5-BAND DSP CURVE:")
            for freq, value in bands.items():
                try:
                    numeric = int(value)
                except (TypeError, ValueError):
                    continue
                bar = "#" * max(0, numeric + 10)
                print(f"  {str(freq):8s} [{numeric:+3d} dB] |{bar}")
            if eq.get("bassBoostPct"):
                print(f"  Bass boost:   {eq.get('bassBoostPct')}%")
            if eq.get("virtualizerPct"):
                print(f"  Virtualizer:  {eq.get('virtualizerPct')}%")
            if eq.get("reverbPreset"):
                print(f"  Reverb space: {eq.get('reverbPreset')}")
            print()
            return 0

        if args.batch_lrc:
            folder = Path(args.batch_lrc)
            if not folder.is_dir():
                print(f"[error] {folder} is not a directory.", file=sys.stderr)
                return 1
            audio_files = [
                path for path in folder.iterdir()
                if path.suffix.lower() in {".mp3", ".m4a", ".flac", ".wav", ".aac", ".ogg"}
            ]
            print(f"Found {len(audio_files)} audio file(s) in {folder}.")
            for audio in audio_files:
                lrc_path = audio.with_suffix(".lrc")
                if lrc_path.exists():
                    print(f"  skip {audio.name} (LRC exists)")
                    continue
                print(f"  {audio.name}…")
                try:
                    lrc_path.write_text(
                        generate_lrc(audio.stem, api_key=args.key, prefer=args.provider),
                        encoding="utf-8",
                    )
                    print(f"    -> {lrc_path.name}")
                except Exception as error:
                    print(f"    -> failed: {error}", file=sys.stderr)
            return 0

        parser.print_help()
        return 0

    except AIProviderError as error:
        return _print_error(error)
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
