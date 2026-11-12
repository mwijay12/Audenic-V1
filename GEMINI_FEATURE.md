# Audenic — Personal AI Music & Media Player

**Audenic** is your customized, personal AI-first multimedia player powered by **Google Gemini 3.8 Flash** (`gemini-3.8-flash`).

Built specifically for personal use ("ni mine tu") with cutting-edge AI capabilities that elevate offline audio playback, lyrics synchronization, acoustic tuning, and file transfer.

---

## 🌟 What Makes Audenic Stand Out

### 1. 🎙️ Audenic AI Radio DJ (Live Voiceover Commentary)
- **Concept**: Radio-station experience in your pocket. Before tracks or during transitions, Audenic's resident AI host, **DJ Neo**, generates smooth, energetic broadcast voiceovers (e.g., *"You're locked into Audenic. Coming up next is a certified anthem from Burna Boy..."*).
- **Web Speech & Voice**: Built-in voice playback in the Web Studio (`🔊 Play Voice (TTS)`).
- **CLI Command**:
  ```powershell
  .\gemini.bat --dj "Rema - Calm Down"
  ```

### 2. 🎚️ Sonic Equalizer & 5-Band DSP Curve Advisor
- **Concept**: Tailors Audenic's 5-band hardware equalizer to the exact acoustic profile of any song or genre.
- **Spectrum Bands**: 60Hz (Sub-bass), 230Hz (Mid-bass), 910Hz (Vocal Midrange), 3.6kHz (Presence), and 14kHz (Treble/Air).
- **Dynamic DSP**: Suggests exact Bass Boost %, 3D Sound Virtualizer %, and Acoustic Reverb spaces (Hall, MediumRoom, SmallRoom).
- **CLI Command**:
  ```powershell
  .\gemini.bat --eq "Afrobeats"
  ```

### 3. 🎵 AI Synchronized Karaoke Lyrics (`.lrc`) Generator & Translator
- Generates standard, precision-timed `.lrc` lyrics (`[mm:ss.xx] Lyric line`) matching Audenic's native scrolling karaoke display.
- **Multilingual Cadence Translation**: Translates lyrics into Swahili, Spanish, French, Portuguese, Arabic, Hindi, etc., while preserving the exact rhythmic timestamps.
- **Live Interactive Karaoke Visualizer**: Test the synced lyrics directly in the web browser with live scrolling and active line glows.
- **CLI Command**:
  ```powershell
  .\gemini.bat --lrc "The Weeknd - Blinding Lights" --lang "Swahili"
  ```

### 4. 🏷️ Smart Audio Tag & Metadata Cleaner
- Normalizes messy filenames from YouTube/converters (`yt1s.com - Burna_Boy_City_Boys_Official_Video_1080p.mp3`) into clean Title, Artist, Album, Year, Genre, and Musical Mood.
- **CLI Command**:
  ```powershell
  .\gemini.bat --tag "messy_downloaded_track.mp3"
  ```

### 5. 📻 Smart Playlist DJ (`.m3u` Curator)
- Translates vibe and mood prompts into cohesive 10-15 track playlists with durations and mood tags, exported directly as standard `.m3u` files compatible with Audenic.
- **CLI Command**:
  ```powershell
  .\gemini.bat --playlist "East African chill bongo flava midnight drive" --out bongo.m3u
  ```

---

## 📱 Audenic Android APK

The decompiled project in `work/decoded/` has been rebranded across all 48 localized resource files to **Audenic**. A signed, zip-aligned APK is already built and ready to install on your Android device:

- **Ready-to-Install APK**: [Audenic.apk](file:///c:/Users/Administrator/Desktop/Audenic.apk) (also saved at `C:\Users\Administrator\Desktop\Audenic.apk`)
- **Signature**: Android v2/v3 verified, Zip-aligned, 21.7 MB

### How to Rebuild the APK Anytime
If you make additional edits inside `work\decoded\`:
```powershell
.\build_audenic.bat
```
This automatically recompiles with Apktool, zip-aligns, and signs `Audenic.apk`.

---

## 🖥️ Audenic Web Studio & Local Companion

### Launch the Web Studio
```powershell
.\gemini.bat --serve --port 8080
```
Open **[http://localhost:8080](http://localhost:8080)** in Chrome/Edge:
1. Click the **✨ Gemini AI Studio** tab in the header.
2. Enter your free Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
3. Access all 5 AI modules: Synced Lyrics, Tag Cleaner, Playlist DJ, AI Radio DJ, and Sonic EQ Advisor!

---

## 📂 Key Project Files

- [Audenic.apk](file:///c:/Users/Administrator/Desktop/LARK/Audenic.apk): Ready-to-install Android APK
- [build_audenic.bat](file:///c:/Users/Administrator/Desktop/LARK/build_audenic.bat): 1-click APK build and sign pipeline
- [gemini_companion.py](file:///c:/Users/Administrator/Desktop/LARK/gemini_companion.py): Python CLI & Companion Server
- [gemini.bat](file:///c:/Users/Administrator/Desktop/LARK/gemini.bat): Windows CLI launcher
- [assets/transfer_web/gemini.js](file:///c:/Users/Administrator/Desktop/LARK/assets/transfer_web/gemini.js): Web Studio AI client
- [assets/transfer_web/index.html](file:///c:/Users/Administrator/Desktop/LARK/assets/transfer_web/index.html): Web Studio UI
- [assets/transfer_web/app.css](file:///c:/Users/Administrator/Desktop/LARK/assets/transfer_web/app.css): Audenic dark-theme styling
- [work/decoded/](file:///c:/Users/Administrator/Desktop/LARK/work/decoded/): Decompiled APK source tree with Audenic branding
