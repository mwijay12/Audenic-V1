# Audenic V1 ✦
### Intelligent Lossless Music, Reels & Audio AI Suite for Android

Audenic V1 is an advanced Android music and video streaming player engineered on high-fidelity native architecture, featuring deep local media scanning, high-resolution playback, and a dedicated **Audenic AI Studio** powered by Google Gemini and Groq neural inference engines.

---

## ✦ Key Architecture & Pillars

Audenic strictly preserves authentic Android native performance while integrating modern AI capabilities:

1. **Home (Native Audio Engine)**:
   - High-performance local media indexer and native RecyclerView song lists.
   - Low-latency audio playback pipeline with background playback service.
   - Native bottom mini-player with gesture controls, circular progress, and repeat/shuffle states.

2. **Reels (Full-Screen Video Engine)**:
   - Native vertical video player scanning device camera rolls and media folders.
   - Smooth gesture navigation and vertical snapping.

3. **Explore & Library**:
   - Native playlist manager (`Recently played`, `Most played`, `With Lyrics`, `Liked songs`).
   - Deep folder navigation (`Music`, `SnapTube Audio`, `WhatsApp Business Audio`, etc.).

4. **Settings & Audenic AI Studio**:
   - Embedded cleanly inside the native Settings menu (`✦ Audenic AI Studio`).
   - Zero disruption to background music playback.
   - Dark AMOLED matte styling (`#0E1015`) obeying system safe-area insets and status bar notches.

---

## ✦ AI Studio Capabilities

Powered by **Groq High-Speed Inference** (Qwen 27B / GPT-OSS 120B / LLaMA 3.3 70B) with automatic failover to **Google Gemini 3.8 Flash**:

- **Synchronized Lyrics (.LRC)**: Generates millisecond-accurate timestamped lyrics (`[mm:ss.xx]`) for local tracks, gospel hymns, and contemporary songs with 1-click clipboard export.
- **Vibe & Playlist Curator**: Natural language music curation based on mood, scripture, Sunday devotion themes, or African rhythms.
- **5-Band Acoustic Equalizer**: Computes optimal parametric gain curves for 60Hz, 230Hz, 910Hz, 3.6kHz, and 14kHz.
- **Dynamic Cloud Vault**: Decouples API keys from application binaries. Credentials are dynamically resolved at runtime with zero hardcoded secrets.

---

## ✦ Reverse Engineering & Smali Patches

1. **Dalvik Verifier Type Widening (`MainContentFragment.smali`)**:
   - Fixed `java.lang.VerifyError` by widening `field public b:Lcom/dywx/v4/gui/base/BaseLazyFragment;` to `Lcom/dywx/v4/gui/base/BaseFragment;`, resolving polymorphic compatibility across fragment lifecycles.

2. **Asset Scheme Normalization (`WebViewActivity.smali` & `BuildinHybridImpl.smali`)**:
   - Enabled `setAllowFileAccess(true)`, `setAllowFileAccessFromFileURLs(true)`, and bypassed query-parameter appending on `file:///android_asset/` URLs.

3. **Settings Navigation Wiring (`SettingsFragment.smali`)**:
   - Redirected `remove_ads_layout` click handler to launch `WebViewActivity` pointing directly to the bundled Audenic AI Studio asset.

---

## ✦ Build & Deployment

### Prerequisites
- Java JDK 21+ (`bin/java.exe`)
- Python 3.10+
- Android SDK / `adb`
- `uber-apk-signer`

### Automated Build
Run the automated build script:
```cmd
build_audenic.bat
```
or via Python:
```bash
python build_audenic.py
```

The script will:
1. Generate the crisp vector Lottie header.
2. Patch binary `resources.arsc` strings, branding, and navigation tabs.
3. Package the patched classes (`classes4.dex`, `classes5.dex`) and assets.
4. Align and sign the final APK with v2/v3 signatures into `dist/Audenic.apk`.

### Direct Device Installation
```bash
adb install -r Audenic.apk
```

---

## ✦ License & Credits
Re-engineered with love for high-fidelity audio enthusiasts.
Powered by Groq Cloud & Google Gemini AI.
