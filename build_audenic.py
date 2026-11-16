"""
Build the rebranded Audenic APK from the decompiled Lark tree.

Every path can be overridden with an environment variable, so the script is not
tied to one Windows profile:

  AUDENIC_ROOT        project root            (default: <repo> or Desktop\\LARK)
  AUDENIC_SOURCE_APK  source Lark_Player.zip
  AUDENIC_WEB_DIR     Studio assets           (default: ./assets/transfer_web)
  AUDENIC_OUT         final output directory

The Studio assets default to *this repository's* assets/transfer_web, so a
rebuild always ships the current UI rather than a stale copy on the Desktop.

Commands:

  python build_audenic.py                  build, sign, and verify the Studio
  python build_audenic.py --doctor         show resolved paths and what is missing
  python build_audenic.py --verify A.apk   does this APK carry the current Studio?
  python build_audenic.py --fetch-tools    download uber-apk-signer into ./tools
  python build_audenic.py --no-sign        package + verify, sign it yourself
  python build_audenic.py --regen-lottie   re-render test_audenic.lottie via browser

Every build re-hashes the packaged Studio against this repo and aborts before
signing if a single byte differs, so an APK can never quietly ship an old UI.
"""

import hashlib
import os
import shutil
import struct
import subprocess
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ROOT = r"C:\Users\Administrator\Desktop\LARK"
ROOT = os.environ.get("AUDENIC_ROOT") or (HERE if os.path.isdir(os.path.join(HERE, "assets")) else DEFAULT_ROOT)

LARK_ZIP = os.environ.get("AUDENIC_SOURCE_APK") or os.path.join(ROOT, "Lark_Player.zip")
if not os.path.isfile(LARK_ZIP):
    _bundled_source = os.path.join(HERE, "source", "Lark_Player.zip")
    if os.path.isfile(_bundled_source):
        LARK_ZIP = _bundled_source
WORK_BUILD = os.environ.get("AUDENIC_WORK_BUILD") or os.path.join(ROOT, "work", "decoded", "build", "apk")
BRANDING_DIR = os.path.join(HERE, "branding")

# The Studio always comes from this repository, so a rebuild cannot ship a stale UI.
REPO_WEB = os.path.join(HERE, "assets", "transfer_web")
WEB_TRANSFER = os.environ.get("AUDENIC_WEB_DIR") or REPO_WEB
if not os.path.isdir(WEB_TRANSFER):
    WEB_TRANSFER = os.path.join(ROOT, "assets", "transfer_web")

DEX_DIR = os.environ.get("AUDENIC_DEX_DIR") or os.path.join(ROOT, "dex_out")
if not os.path.isdir(DEX_DIR):
    DEX_DIR = os.path.join(HERE, "dex_out")

TEMP_APK = os.path.join(ROOT, "audenic_unsigned.apk")
FINAL_DIR = os.environ.get("AUDENIC_OUT") or os.path.join(ROOT, "dist")
AUDENIC_LOTTIE = os.path.join(ROOT, "test_audenic.lottie")
if not os.path.isfile(AUDENIC_LOTTIE):
    AUDENIC_LOTTIE = os.path.join(HERE, "test_audenic.lottie")
GEN_LOTTIE_SCRIPT = os.path.join(HERE, "generate_audenic_lottie.py")

# The Studio is a runtime asset; its tests and docs stay out of the APK.
STUDIO_EXCLUDE = {"core.test.mjs", "README.md"}

SKIP_SIGN = "--no-sign" in sys.argv
REGEN_LOTTIE = "--regen-lottie" in sys.argv
SIGNER_VERSION = "1.3.0"
SIGNER_NAME = f"uber-apk-signer-{SIGNER_VERSION}.jar"
SIGNER_URL = (
    "https://github.com/patrickfav/uber-apk-signer/releases/download/"
    f"v{SIGNER_VERSION}/{SIGNER_NAME}"
)


def _resolve_java():
    env = os.environ.get("AUDENIC_JAVA")
    if env:
        return env
    found = shutil.which("java")
    if found:
        return found
    return r"C:\Users\Administrator\AppData\Local\Temp\opencode\tools\jdk\jdk-21.0.13+9\bin\java.exe"


def _resolve_signer():
    env = os.environ.get("AUDENIC_SIGNER")
    if env:
        return env
    for candidate in (
        os.path.join(HERE, "tools", SIGNER_NAME),
        os.path.join(HERE, "tools", "uber-apk-signer.jar"),
        os.path.join(ROOT, "tools", SIGNER_NAME),
        os.path.join(ROOT, "tools", "uber-apk-signer.jar"),
    ):
        if os.path.isfile(candidate):
            return candidate
    return r"C:\Users\Administrator\AppData\Local\Temp\opencode\tools\uber-apk-signer.jar"


JAVA_EXE = _resolve_java()
SIGNER_JAR = _resolve_signer()


def _java_available():
    return bool(JAVA_EXE) and (os.path.isfile(JAVA_EXE) or bool(shutil.which(JAVA_EXE)))


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def sha256_file(path):
    with open(path, "rb") as handle:
        return sha256_bytes(handle.read())


def studio_files(web_dir=None):
    """Map every Studio asset to its hash, keyed by its path inside the APK."""
    web_dir = web_dir or WEB_TRANSFER
    manifest = {}
    for root, _dirs, files in os.walk(web_dir):
        for name in files:
            if name in STUDIO_EXCLUDE:
                continue
            full = os.path.join(root, name)
            rel = os.path.relpath(full, web_dir).replace("\\", "/")
            manifest["assets/transfer_web/" + rel] = sha256_file(full)
    return manifest


def verify_apk(apk_path, web_dir=None, label="APK"):
    """Prove the APK carries this repo's Studio, byte for byte."""
    expected = studio_files(web_dir)
    index_key = "assets/transfer_web/index.html"
    index_want = expected.get(index_key, "")

    if not os.path.isfile(apk_path):
        print(f"[verify] {label}: not found — {apk_path}")
        return False
    if not expected:
        print(f"[verify] {label}: no Studio assets in {web_dir or WEB_TRANSFER}")
        return False

    try:
        with zipfile.ZipFile(apk_path) as archive:
            present = set(archive.namelist())
            missing = sorted(key for key in expected if key not in present)
            changed = sorted(
                key for key, want in expected.items()
                if key in present and sha256_bytes(archive.read(key)) != want
            )
            index_have = (
                sha256_bytes(archive.read(index_key)) if index_key in present else ""
            )
    except zipfile.BadZipFile:
        print(f"[verify] {label}: not a valid APK/zip — {apk_path}")
        return False

    ok = not missing and not changed and index_have == index_want
    print(f"[verify] {label}: {apk_path}")
    print(f"         studio files : {len(expected)} expected, {len(expected) - len(missing)} found")
    print(f"         index.html   : {(index_have[:16] or 'missing')} (repo {index_want[:16]})")
    for key in missing[:5]:
        print(f"         missing      : {key}")
    for key in changed[:5]:
        print(f"         differs      : {key}")
    print(
        "         result       : OK — APK ships the current Studio"
        if ok else "         result       : MISMATCH — rebuild before shipping"
    )
    return ok


def _encode_utf8_len(val):
    if val <= 0x7F:
        return bytes([val])
    return bytes([0x80 | ((val >> 8) & 0x7F), val & 0xFF])


def _decode_utf8_at(data, off):
    b = data[off]
    off += 1
    if b & 0x80:
        off += 1
    b2 = data[off]
    off += 1
    if b2 & 0x80:
        u8len = ((b2 & 0x7F) << 8) | data[off]
        off += 1
    else:
        u8len = b2
    return data[off : off + u8len].decode("utf-8", errors="surrogatepass")


def _encode_utf8_entry(text):
    u8 = text.encode("utf-8", errors="surrogatepass")
    u16len = len(text.encode("utf-16-le", errors="surrogatepass")) // 2
    return _encode_utf8_len(u16len) + _encode_utf8_len(len(u8)) + u8 + b"\x00"


def _is_technical_arsc_string(text):
    if any(
        text.startswith(prefix)
        for prefix in ("res/", "assets/", "com.", "org.", "http", "android", "META-INF", "larkplayer.")
    ):
        return True
    lower = text.lower()
    if any(
        token in lower
        for token in ("lark-player-", ".appspot.com", ".firebaseapp.com", ".firebaseio.com", ".googleapis.com")
    ):
        return True
    return False


def _rebrand_arsc_string(text):
    if _is_technical_arsc_string(text):
        return text
    new_s = text
    for old, new in (
        ("Lark Player", "Audenic"),
        ("LarkPlayer", "Audenic"),
        ("Lark player", "Audenic"),
        ("lark player", "audenic"),
        ("larkplayer", "audenic"),
        ("Mini Lark", "Mini Audenic"),
    ):
        if old in new_s:
            new_s = new_s.replace(old, new)
    if "Lark" in new_s and not any(k in new_s for k in ("Clark", "Malark")):
        new_s = new_s.replace("Lark", "Audenic")
    if "lark" in new_s and not any(k in new_s for k in ("clark", "malark")):
        new_s = new_s.replace("lark", "audenic")
    return new_s


TAB_PATCHES = {
    11809: ("Videos", "Reels"),
    11502: ("Songs", "Home"),
    11326: ("Playlists", "Explore"),
    10975: ("Folders", "Library"),
    11337: ("Premium", "AI Studio"),
    10718: ("Backup & restore", "Cloud AI Vault"),
}


def patch_resources_arsc(arsc_data):
    """Rebrand strings and navigation tabs in resources.arsc by cleanly rebuilding the UTF-8 string pool."""
    rt_type, rt_hdr, rt_size, pkg_count = struct.unpack_from("<HHII", arsc_data, 0)
    if rt_type != 0x0002:
        raise ValueError(f"Unexpected ResTable type: 0x{rt_type:04x}")

    sp_offset = rt_hdr
    chunk_type, chunk_hdr, chunk_size = struct.unpack_from("<HHI", arsc_data, sp_offset)
    if chunk_type != 0x0001:
        raise ValueError(f"Unexpected string pool chunk type: 0x{chunk_type:04x}")

    string_count, style_count, flags, strings_start, styles_start = struct.unpack_from(
        "<IIIII", arsc_data, sp_offset + 8
    )
    if not (flags & 0x100):
        raise ValueError("Expected UTF-8 string pool in resources.arsc")

    orig_offsets = struct.unpack_from(f"<{string_count}I", arsc_data, sp_offset + chunk_hdr)
    orig_style_offsets = arsc_data[sp_offset + chunk_hdr + string_count * 4 : sp_offset + strings_start]
    styles_blob = (
        arsc_data[sp_offset + styles_start : sp_offset + chunk_size]
        if style_count > 0 and styles_start > 0
        else b""
    )

    patched_count = 0
    tab_patched_count = 0
    new_blob = bytearray()
    new_offsets = []

    for i in range(string_count):
        orig = _decode_utf8_at(arsc_data, sp_offset + strings_start + orig_offsets[i])
        updated = orig

        if i in TAB_PATCHES:
            expected_orig, new_tab = TAB_PATCHES[i]
            if orig in (expected_orig, new_tab):
                updated = new_tab
                tab_patched_count += 1
        else:
            # Skip styled strings so span character indices stay valid
            if i >= style_count:
                updated = _rebrand_arsc_string(orig)
                if updated != orig:
                    patched_count += 1

        new_offsets.append(len(new_blob))
        new_blob.extend(_encode_utf8_entry(updated))

    while len(new_blob) % 4 != 0:
        new_blob.append(0)

    new_styles_start = (strings_start + len(new_blob)) if styles_blob else 0
    new_chunk_size = strings_start + len(new_blob) + len(styles_blob)
    delta = new_chunk_size - chunk_size
    new_rt_size = rt_size + delta

    out = bytearray()
    out.extend(struct.pack("<HHII", rt_type, rt_hdr, new_rt_size, pkg_count))
    out.extend(
        struct.pack(
            "<HHIIIIII",
            chunk_type,
            chunk_hdr,
            new_chunk_size,
            string_count,
            style_count,
            flags,
            strings_start,
            new_styles_start,
        )
    )
    out.extend(struct.pack(f"<{string_count}I", *new_offsets))
    out.extend(orig_style_offsets)
    out.extend(new_blob)
    out.extend(styles_blob)
    out.extend(arsc_data[sp_offset + chunk_size :])
    return bytes(out), patched_count, tab_patched_count


def _is_apk_signature_entry(name):
    """Return True only for APK v1 signature files that must be regenerated on signing."""
    if not name.startswith("META-INF/"):
        return False
    rest = name[len("META-INF/") :]
    if "/" in rest:
        return False
    upper = rest.upper()
    return upper == "MANIFEST.MF" or upper.endswith((".SF", ".RSA", ".DSA", ".EC", ".SIG"))


def _resolve_branding_assets():
    """Prefer local apktool output when present, otherwise use tracked branding/ assets."""
    def pick(*candidates):
        for path in candidates:
            if path and os.path.isfile(path):
                return path
        return candidates[-1]

    assets = {
        "res/drawable/ic_launcher_background.xml": pick(
            os.path.join(WORK_BUILD, "res", "drawable", "ic_launcher_background.xml"),
            os.path.join(BRANDING_DIR, "res", "drawable", "ic_launcher_background.xml"),
        ),
        "res/drawable/ic_launcher_foreground.xml": pick(
            os.path.join(WORK_BUILD, "res", "drawable", "ic_launcher_foreground.xml"),
            os.path.join(BRANDING_DIR, "res", "drawable", "ic_launcher_foreground.xml"),
        ),
        "res/drawable/splash_logo.xml": pick(
            os.path.join(WORK_BUILD, "res", "drawable", "splash_logo.xml"),
            os.path.join(BRANDING_DIR, "res", "drawable", "splash_logo.xml"),
        ),
        "res/drawable-v31/splash_logo.xml": pick(
            os.path.join(WORK_BUILD, "res", "drawable-v31", "splash_logo.xml"),
            os.path.join(BRANDING_DIR, "res", "drawable-v31", "splash_logo.xml"),
        ),
        "res/drawable/icon.xml": pick(
            os.path.join(WORK_BUILD, "res", "drawable", "ic_launcher_foreground.xml"),
            os.path.join(BRANDING_DIR, "res", "drawable", "icon.xml"),
        ),
        "res/drawable/ic_logo.xml": pick(
            os.path.join(BRANDING_DIR, "res", "drawable", "ic_logo.xml"),
            os.path.join(WORK_BUILD, "res", "drawable", "splash_logo.xml"),
        ),
        "res/drawable-xhdpi-v4/ic_stat_larkplayer.png": pick(
            os.path.join(ROOT, "ic_stat_audenic.png"),
            os.path.join(BRANDING_DIR, "res", "drawable-xhdpi-v4", "ic_stat_larkplayer.png"),
        ),
        "res/drawable-xxhdpi-v4/ic_notification_default_cover.png": pick(
            os.path.join(WORK_BUILD, "res", "drawable-xxhdpi-v4", "ic_notification_default_cover.png"),
            os.path.join(BRANDING_DIR, "res", "drawable-xxhdpi-v4", "ic_notification_default_cover.png"),
        ),
        "res/drawable/ic_notification.xml": pick(
            os.path.join(WORK_BUILD, "res", "drawable", "ic_notification.xml"),
            os.path.join(BRANDING_DIR, "res", "drawable", "ic_notification.xml"),
        ),
        "res/drawable/ic_song_default_notification_cover.xml": pick(
            os.path.join(WORK_BUILD, "res", "drawable", "ic_song_default_notification_cover.xml"),
            os.path.join(BRANDING_DIR, "res", "drawable", "ic_song_default_notification_cover.xml"),
        ),
    }

    for density in ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"):
        for kind in ("ic_launcher.webp", "ic_launcher_round.webp"):
            assets[f"res/mipmap-{density}-v4/{kind}"] = pick(
                os.path.join(WORK_BUILD, "res", f"mipmap-{density}-v4", kind),
                os.path.join(WORK_BUILD, "res", f"mipmap-{density}", kind),
                os.path.join(BRANDING_DIR, "res", f"mipmap-{density}-v4", kind),
            )
    return assets


def _flag_value(flag):
    if flag not in sys.argv:
        return None
    position = sys.argv.index(flag)
    if position + 1 >= len(sys.argv):
        print(f"{flag} needs a file path")
        sys.exit(2)
    return sys.argv[position + 1]


def _doctor():
    checks = [
        ("source APK", LARK_ZIP, os.path.isfile(LARK_ZIP)),
        ("Studio", WEB_TRANSFER, os.path.isdir(WEB_TRANSFER)),
        ("java", JAVA_EXE, _java_available()),
        ("signer", SIGNER_JAR, os.path.isfile(SIGNER_JAR)),
        ("dex_out", DEX_DIR, os.path.isdir(DEX_DIR)),
        ("branding", BRANDING_DIR, os.path.isdir(BRANDING_DIR)),
        ("lottie", AUDENIC_LOTTIE, os.path.isfile(AUDENIC_LOTTIE)),
    ]
    print("Audenic build doctor")
    print("-" * 64)
    for name, path, ok in checks:
        print(f"{'OK  ' if ok else 'MISS'} {name:<11} {path}")

    manifest = studio_files()
    branding = _resolve_branding_assets()
    branding_present = sum(1 for p in branding.values() if os.path.isfile(p))
    print()
    print(f"Studio files : {len(manifest)}")
    print(f"Branding     : {branding_present} / {len(branding)} assets ready")
    print(f"index.html   : {manifest.get('assets/transfer_web/index.html', '')[:16]}")
    print(f"output dir   : {FINAL_DIR}")
    if os.path.isfile(LARK_ZIP):
        print(f"source size  : {os.path.getsize(LARK_ZIP):,} bytes")
    if _java_available():
        try:
            probe = subprocess.run([JAVA_EXE, "-version"], capture_output=True, text=True)
            first = (probe.stderr or probe.stdout).strip().splitlines()
            print(f"java version : {first[0] if first else 'unknown'}")
        except OSError as error:
            print(f"java version : cannot run ({error})")

    missing = [name for name, _path, ok in checks[:4] if not ok]
    print()
    if missing:
        print("Missing: " + ", ".join(missing))
        print("Fix with --fetch-tools (signer), a JDK install, or AUDENIC_* variables.")
        return 1
    print("Ready to build: python build_audenic.py")
    return 0


def _fetch_tools():
    tools_dir = os.path.join(HERE, "tools")
    os.makedirs(tools_dir, exist_ok=True)
    target = os.path.join(tools_dir, SIGNER_NAME)
    if os.path.isfile(target):
        print(f"Already present: {target}")
        return 0

    print(f"Downloading uber-apk-signer {SIGNER_VERSION} …")
    import urllib.request

    request = urllib.request.Request(SIGNER_URL, headers={"User-Agent": "audenic-build"})
    try:
        with urllib.request.urlopen(request, timeout=120) as response, open(target, "wb") as handle:
            shutil.copyfileobj(response, handle)
    except Exception as error:
        print(f"Download failed: {error}")
        print(f"Get it manually: {SIGNER_URL}")
        return 1

    size = os.path.getsize(target)
    print(f"Saved {target} ({size:,} bytes)")
    print("A JDK is still required — set AUDENIC_JAVA if java is not on PATH.")
    return 0


def _preflight():
    missing = []
    if not os.path.isfile(LARK_ZIP):
        missing.append(f"source APK: {LARK_ZIP}")
    if not os.path.isdir(WEB_TRANSFER):
        missing.append(f"Studio assets: {WEB_TRANSFER}")
    if not SKIP_SIGN:
        if not os.path.isfile(SIGNER_JAR):
            missing.append(f"uber-apk-signer: {SIGNER_JAR}")
        if not _java_available():
            missing.append(f"java: {JAVA_EXE}")
    if missing:
        print("Cannot build — missing inputs:")
        for item in missing:
            print(f"  - {item}")
        print()
        print("Run `python build_audenic.py --doctor` for the full picture.")
        if not SKIP_SIGN:
            print("Run `python build_audenic.py --fetch-tools` to get the signer.")
        print("Override paths with AUDENIC_ROOT, AUDENIC_SOURCE_APK, AUDENIC_WEB_DIR,")
        print("AUDENIC_DEX_DIR, AUDENIC_JAVA and AUDENIC_SIGNER.")
        sys.exit(1)


def main():
    if _flag_value("--verify") is not None:
        sys.exit(0 if verify_apk(_flag_value("--verify"), label="requested APK") else 1)
    if "--doctor" in sys.argv:
        sys.exit(_doctor())
    if "--fetch-tools" in sys.argv:
        sys.exit(_fetch_tools())

    _preflight()

    studio = studio_files()
    print(f"Source APK : {LARK_ZIP}")
    print(f"Studio     : {WEB_TRANSFER}")
    print(f"             {len(studio)} files · index.html {studio.get('assets/transfer_web/index.html', '')[:16]}")
    print(f"Output     : {FINAL_DIR}")

    # Step 0: Ensure crisp Lottie container
    if (REGEN_LOTTIE or not os.path.isfile(AUDENIC_LOTTIE)) and os.path.isfile(GEN_LOTTIE_SCRIPT):
        print("[0/5] Generating Audenic Lottie container...")
        subprocess.run([sys.executable, GEN_LOTTIE_SCRIPT], check=True)
    elif os.path.isfile(AUDENIC_LOTTIE):
        print(f"[0/5] Using Audenic Lottie container: {AUDENIC_LOTTIE}")
    else:
        print("[0/5] Lottie container not found — keeping source animation.")

    print("[1/5] Patching resources.arsc...")
    with zipfile.ZipFile(LARK_ZIP, "r") as z:
        raw_arsc = z.read("resources.arsc")
    patched_arsc, patched_count, tab_patched_count = patch_resources_arsc(raw_arsc)
    print(f"Patched {patched_count} strings and {tab_patched_count}/{len(TAB_PATCHES)} navigation tabs to Audenic in resources.arsc!")

    print("[2/5] Preparing APK file map...")
    files_to_copy = {}
    stored_entries = set()
    with zipfile.ZipFile(LARK_ZIP, "r") as z:
        for item in z.infolist():
            if _is_apk_signature_entry(item.filename):
                continue
            files_to_copy[item.filename] = z.read(item.filename)
            if item.compress_type == zipfile.ZIP_STORED:
                stored_entries.add(item.filename)

    files_to_copy["resources.arsc"] = patched_arsc

    # Override classes4.dex and classes5.dex with Audenic patches
    modified_dex4 = os.path.join(DEX_DIR, "classes4.dex")
    if os.path.exists(modified_dex4):
        with open(modified_dex4, "rb") as fp:
            files_to_copy["classes4.dex"] = fp.read()
        print(f"Replaced classes4.dex ({len(files_to_copy['classes4.dex'])} bytes)")

    modified_dex5 = os.path.join(DEX_DIR, "classes5.dex")
    if os.path.exists(modified_dex5):
        with open(modified_dex5, "rb") as fp:
            files_to_copy["classes5.dex"] = fp.read()
        print(f"Replaced classes5.dex ({len(files_to_copy['classes5.dex'])} bytes)")

    # Override web transfer files with Audenic AI Studio
    web_file_count = 0
    for root, _dirs, files in os.walk(WEB_TRANSFER):
        for f in files:
            if f in STUDIO_EXCLUDE:
                continue
            full_path = os.path.join(root, f)
            rel_path = os.path.relpath(full_path, WEB_TRANSFER).replace("\\", "/")
            apk_path = "assets/transfer_web/" + rel_path
            with open(full_path, "rb") as fp:
                files_to_copy[apk_path] = fp.read()
            web_file_count += 1
    print(f"Added {web_file_count} files to assets/transfer_web/")

    # Override Header Lottie animations with Audenic
    if os.path.exists(AUDENIC_LOTTIE):
        with open(AUDENIC_LOTTIE, "rb") as fp:
            lottie_bytes = fp.read()
        for lottie_name in (
            "assets/reply_en.lottie",
            "assets/reply_es.lottie",
            "assets/reply_pt.lottie",
            "assets/reply_fr.lottie",
            "assets/reply_ar.lottie",
            "assets/top.lottie",
            "assets/top_arab.lottie",
        ):
            files_to_copy[lottie_name] = lottie_bytes
        print("Replaced 7 header Lottie animations with Audenic animation")

    # Override launcher drawables, webp icons, splash and notification art
    replacement_drawables = _resolve_branding_assets()
    replaced_branding = 0
    for apk_key, local_path in replacement_drawables.items():
        if os.path.exists(local_path):
            with open(local_path, "rb") as fp:
                files_to_copy[apk_key] = fp.read()
            replaced_branding += 1
        else:
            print(f"Missing replacement: {local_path}")
    print(f"Applied {replaced_branding}/{len(replacement_drawables)} Audenic branding assets")

    print("[3/5] Packaging APK...")
    if os.path.exists(TEMP_APK):
        os.remove(TEMP_APK)

    with zipfile.ZipFile(TEMP_APK, "w", zipfile.ZIP_DEFLATED) as z_out:
        for fname, data in files_to_copy.items():
            if fname.endswith(".arsc") or fname in stored_entries:
                z_out.writestr(fname, data, compress_type=zipfile.ZIP_STORED)
            else:
                z_out.writestr(fname, data, compress_type=zipfile.ZIP_DEFLATED)

    print(f"Created unsigned APK: {TEMP_APK} ({os.path.getsize(TEMP_APK)} bytes)")

    print("[3b/5] Verifying the Studio inside the packaged APK...")
    if not verify_apk(TEMP_APK, label="unsigned APK"):
        print()
        print("ABORTED — the packaged APK does not match this repo's Studio.")
        print("Nothing was signed; fix the mismatch and run the build again.")
        sys.exit(3)

    if SKIP_SIGN:
        print()
        print("Packaged and verified. Signing skipped (--no-sign).")
        print(f"Unsigned APK : {TEMP_APK}")
        print(f'Sign it with : java -jar "{SIGNER_JAR}" -a "{TEMP_APK}" -o "{FINAL_DIR}" --allowResign')
        print("Your own key : add --ks my.jks --ksAlias alias --ksPass pass --ksKeyPass pass")
        sys.exit(0)

    print("[4/5] Aligning and signing with uber-apk-signer...")
    os.makedirs(FINAL_DIR, exist_ok=True)
    cmd = [JAVA_EXE, "-jar", SIGNER_JAR, "-a", TEMP_APK, "-o", FINAL_DIR, "--allowResign"]
    res = subprocess.run(cmd, capture_output=True, text=True)
    print(res.stdout)
    if res.returncode != 0:
        print("Signing error:", res.stderr)
        sys.exit(res.returncode)

    print("[5/5] Copying final Audenic.apk to Desktop and workspace...")
    signed_apk = os.path.join(FINAL_DIR, "audenic_unsigned-aligned-debugSigned.apk")
    if not os.path.exists(signed_apk):
        candidates = [f for f in os.listdir(FINAL_DIR) if f.lower().endswith(".apk")]
        signed_apk = os.path.join(FINAL_DIR, candidates[0]) if candidates else signed_apk

    if not os.path.exists(signed_apk):
        print("Could not find a signed APK in", FINAL_DIR)
        sys.exit(1)

    print()
    if not verify_apk(signed_apk, label="signed APK"):
        sys.exit(3)
    print(f"         sha256       : {sha256_file(signed_apk)}")
    targets = [os.path.join(ROOT, "Audenic.apk")]
    desktop = os.path.join(os.path.expanduser("~"), "Desktop")
    if os.path.isdir(desktop):
        targets.append(os.path.join(desktop, "Audenic.apk"))

    print()
    print("SUCCESS! Final signed Audenic APK is ready (Made by Mwijay):")
    for target in targets:
        try:
            shutil.copy2(signed_apk, target)
            print(f"  -> {target} ({os.path.getsize(target)} bytes)")
        except OSError as error:
            print(f"  -> skipped {target}: {error}")
    print()
    print("Install it with:  adb install -r Audenic.apk")


if __name__ == "__main__":
    main()
