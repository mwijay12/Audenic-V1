"""
Build the rebranded Audenic APK from the decompiled Lark tree.

Every path can be overridden with an environment variable, so the script is not
tied to one Windows profile:

  AUDENIC_ROOT      project root            (default: <repo> or Desktop\LARK)
  AUDENIC_SOURCE_APK  source Lark_Player.zip
  AUDENIC_WEB_DIR     Studio assets          (default: ./assets/transfer_web)
  AUDENIC_OUT         final output directory

The Studio assets default to *this repository's* assets/transfer_web, so a
rebuild always ships the current UI rather than a stale copy on the Desktop.

Commands:

  python build_audenic.py                  build, sign, and verify the Studio
  python build_audenic.py --doctor         show resolved paths and what is missing
  python build_audenic.py --verify A.apk   does this APK carry the current Studio?
  python build_audenic.py --fetch-tools    download uber-apk-signer into ./tools
  python build_audenic.py --no-sign        package + verify, sign it yourself

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
WORK_BUILD = os.environ.get("AUDENIC_WORK_BUILD") or os.path.join(ROOT, "work", "decoded", "build", "apk")

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
GEN_LOTTIE_SCRIPT = os.path.join(ROOT, "generate_audenic_lottie.py")

# The Studio is a runtime asset; its tests and docs stay out of the APK.
STUDIO_EXCLUDE = {"core.test.mjs", "README.md"}

SKIP_SIGN = "--no-sign" in sys.argv
SIGNER_VERSION = "1.3.0"
SIGNER_NAME = f"uber-apk-signer-{SIGNER_VERSION}.jar"
SIGNER_URL = ("https://github.com/patrickfav/uber-apk-signer/releases/download/"
              f"v{SIGNER_VERSION}/{SIGNER_NAME}")


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
    print("         result       : OK — APK ships the current Studio"
          if ok else "         result       : MISMATCH — rebuild before shipping")
    return ok


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
    ]
    print("Audenic build doctor")
    print("-" * 64)
    for name, path, ok in checks:
        print(f"{'OK  ' if ok else 'MISS'} {name:<11} {path}")

    manifest = studio_files()
    print()
    print(f"Studio files : {len(manifest)}")
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
    except Exception as error:  # network, TLS, 404 …
        print(f"Download failed: {error}")
        print(f"Get it manually: {SIGNER_URL}")
        return 1

    size = os.path.getsize(target)
    print(f"Saved {target} ({size:,} bytes)")
    print("A JDK is still required — set AUDENIC_JAVA if java is not on PATH.")
    return 0


if _flag_value("--verify") is not None:
    sys.exit(0 if verify_apk(_flag_value("--verify"), label="requested APK") else 1)
if "--doctor" in sys.argv:
    sys.exit(_doctor())
if "--fetch-tools" in sys.argv:
    sys.exit(_fetch_tools())


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


_preflight()

studio = studio_files()
print(f"Source APK : {LARK_ZIP}")
print(f"Studio     : {WEB_TRANSFER}")
print(f"             {len(studio)} files · index.html {studio.get('assets/transfer_web/index.html', '')[:16]}")
print(f"Output     : {FINAL_DIR}")

# Step 0: Ensure fresh crisp Lottie container
if os.path.isfile(GEN_LOTTIE_SCRIPT):
    print("[0/5] Ensuring crisp Audenic Lottie container...")
    subprocess.run([sys.executable, GEN_LOTTIE_SCRIPT], check=True)
else:
    print("[0/5] Lottie generator not found — keeping the existing animation.")

print("[1/5] Patching resources.arsc...")
with zipfile.ZipFile(LARK_ZIP, "r") as z:
    arsc_bytes = bytearray(z.read("resources.arsc"))

sp_offset = 0xc
chunk_type, chunk_hdr, chunk_size = struct.unpack_from("<HHI", arsc_bytes, sp_offset)
string_count, style_count, flags, strings_start, styles_start = struct.unpack_from("<IIIII", arsc_bytes, sp_offset + 8)

def decode_utf8(data, off):
    b = data[off]; off += 1
    if b & 0x80: off += 1
    b = data[off]; off += 1
    if b & 0x80: u8len = ((b & 0x7f) << 8) | data[off]; off += 1
    else: u8len = b
    return data[off : off + u8len].decode("utf-8", errors="ignore")

def encode_len(val):
    if val <= 0x7f:
        return bytes([val])
    else:
        return bytes([0x80 | ((val >> 8) & 0x7f), val & 0xff])

def patch_utf8_string(data, string_idx, new_text):
    str_off = struct.unpack_from("<I", data, sp_offset + chunk_hdr + string_idx * 4)[0]
    next_off = struct.unpack_from("<I", data, sp_offset + chunk_hdr + (string_idx + 1) * 4)[0]
    max_len = next_off - str_off
    abs_off = sp_offset + strings_start + str_off
    
    encoded = new_text.encode("utf-8")
    u16_char_len = len(new_text)
    u8_byte_len = len(encoded)
    
    hdr = encode_len(u16_char_len) + encode_len(u8_byte_len)
    needed = len(hdr) + u8_byte_len + 1
    if needed > max_len:
        return False
        
    replacement = hdr + encoded + b"\x00" * (max_len - len(hdr) - u8_byte_len)
    data[abs_off : abs_off + max_len] = replacement
    return True

patched_count = 0
for i in range(string_count):
    str_off = struct.unpack_from("<I", arsc_bytes, sp_offset + chunk_hdr + i * 4)[0]
    s = decode_utf8(arsc_bytes, sp_offset + strings_start + str_off)
    if any(s.startswith(p) for p in ["res/", "assets/", "com.", "org.", "http", "android", "META-INF"]):
        continue
    
    new_s = s
    if "Lark Player" in new_s:
        new_s = new_s.replace("Lark Player", "Audenic")
    if "LarkPlayer" in new_s:
        new_s = new_s.replace("LarkPlayer", "Audenic")
    if "Lark player" in new_s:
        new_s = new_s.replace("Lark player", "Audenic")
    if "lark player" in new_s:
        new_s = new_s.replace("lark player", "audenic")
    if "larkplayer" in new_s:
        new_s = new_s.replace("larkplayer", "audenic")
    if "Mini Lark" in new_s:
        new_s = new_s.replace("Mini Lark", "Mini Audenic")
    if "Lark" in new_s and not any(k in new_s for k in ["Clark", "Malark"]):
        new_s = new_s.replace("Lark", "Audenic")
    if "lark" in new_s and not any(k in new_s for k in ["clark", "malark"]):
        new_s = new_s.replace("lark", "audenic")
        
    if new_s != s:
        if patch_utf8_string(arsc_bytes, i, new_s):
            patched_count += 1

# Explicit 5-Tab Navigation Remapping
tab_patches = {
    11809: "Reels",    # was "Videos"
    11502: "Home",     # was "Songs"
    11326: "Explore",  # was "Playlists"
    10975: "Library",  # was "Folders"
    10673: "Setting",  # was "Artists"
    11337: "AI Studio", # was "Premium"
    10718: "Cloud AI Vault", # was "Backup & restore"
}
tab_patched_count = 0
for tab_idx, new_tab in tab_patches.items():
    if patch_utf8_string(arsc_bytes, tab_idx, new_tab):
        tab_patched_count += 1
        print(f"Patched Tab string {tab_idx} -> {new_tab}")
    else:
        print(f"Failed to patch Tab string {tab_idx} -> {new_tab}")

print(f"Patched {patched_count} strings and {tab_patched_count} navigation tabs to Audenic in resources.arsc!")

print("[2/5] Preparing APK file map...")
files_to_copy = {}
with zipfile.ZipFile(LARK_ZIP, "r") as z:
    for item in z.infolist():
        if item.filename.startswith("META-INF/"):
            continue
        files_to_copy[item.filename] = z.read(item.filename)

files_to_copy["resources.arsc"] = bytes(arsc_bytes)

# Override classes4.dex with full-screen Audenic MainActivity launcher
MODIFIED_DEX4 = os.path.join(DEX_DIR, "classes4.dex")
if os.path.exists(MODIFIED_DEX4):
    with open(MODIFIED_DEX4, "rb") as fp:
        files_to_copy["classes4.dex"] = fp.read()
    print(f"Replaced classes4.dex ({len(files_to_copy['classes4.dex'])} bytes) with Full-Screen Audenic launcher")

MODIFIED_DEX5 = os.path.join(DEX_DIR, "classes5.dex")
if os.path.exists(MODIFIED_DEX5):
    with open(MODIFIED_DEX5, "rb") as fp:
        files_to_copy["classes5.dex"] = fp.read()
    print(f"Replaced classes5.dex ({len(files_to_copy['classes5.dex'])} bytes)")

# Override web transfer files with Audenic AI Studio
web_file_count = 0
for root, dirs, files in os.walk(WEB_TRANSFER):
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
    for lottie_name in [
        "assets/reply_en.lottie",
        "assets/reply_es.lottie",
        "assets/reply_pt.lottie",
        "assets/reply_fr.lottie",
        "assets/reply_ar.lottie",
        "assets/top.lottie",
        "assets/top_arab.lottie"
    ]:
        files_to_copy[lottie_name] = lottie_bytes
        print(f"Replaced {lottie_name} with Audenic animation")

# Override compiled launcher drawables, webp icons, and mascots
compiled_foreground = os.path.join(WORK_BUILD, "res", "drawable", "ic_launcher_foreground.xml")
compiled_background = os.path.join(WORK_BUILD, "res", "drawable", "ic_launcher_background.xml")
compiled_splash = os.path.join(WORK_BUILD, "res", "drawable", "splash_logo.xml")
compiled_splash_v31 = os.path.join(WORK_BUILD, "res", "drawable-v31", "splash_logo.xml")

replacement_drawables = {
    "res/drawable/ic_launcher_background.xml": compiled_background,
    "res/drawable/ic_launcher_foreground.xml": compiled_foreground,
    "res/drawable/splash_logo.xml": compiled_splash,
    "res/drawable-v31/splash_logo.xml": compiled_splash_v31,
    "res/drawable/icon.xml": compiled_foreground,
    "res/drawable/ic_logo.xml": compiled_splash,
    "res/mipmap-hdpi-v4/ic_launcher.webp": os.path.join(WORK_BUILD, "res", "mipmap-hdpi", "ic_launcher.webp"),
    "res/mipmap-hdpi-v4/ic_launcher_round.webp": os.path.join(WORK_BUILD, "res", "mipmap-hdpi", "ic_launcher_round.webp"),
    "res/mipmap-mdpi-v4/ic_launcher.webp": os.path.join(WORK_BUILD, "res", "mipmap-mdpi", "ic_launcher.webp"),
    "res/mipmap-mdpi-v4/ic_launcher_round.webp": os.path.join(WORK_BUILD, "res", "mipmap-mdpi", "ic_launcher_round.webp"),
    "res/mipmap-xhdpi-v4/ic_launcher.webp": os.path.join(WORK_BUILD, "res", "mipmap-xhdpi", "ic_launcher.webp"),
    "res/mipmap-xhdpi-v4/ic_launcher_round.webp": os.path.join(WORK_BUILD, "res", "mipmap-xhdpi", "ic_launcher_round.webp"),
    "res/mipmap-xxhdpi-v4/ic_launcher.webp": os.path.join(WORK_BUILD, "res", "mipmap-xxhdpi", "ic_launcher.webp"),
    "res/mipmap-xxhdpi-v4/ic_launcher_round.webp": os.path.join(WORK_BUILD, "res", "mipmap-xxhdpi", "ic_launcher_round.webp"),
    "res/mipmap-xxxhdpi-v4/ic_launcher.webp": os.path.join(WORK_BUILD, "res", "mipmap-xxxhdpi", "ic_launcher.webp"),
    "res/mipmap-xxxhdpi-v4/ic_launcher_round.webp": os.path.join(WORK_BUILD, "res", "mipmap-xxxhdpi", "ic_launcher_round.webp"),
    "res/drawable-xhdpi-v4/ic_stat_larkplayer.png": os.path.join(ROOT, "ic_stat_audenic.png"),
    "res/drawable-xxhdpi-v4/ic_notification_default_cover.png": os.path.join(ROOT, "ic_notification_cover_audenic.png"),
}

for apk_key, local_path in replacement_drawables.items():
    if os.path.exists(local_path):
        with open(local_path, "rb") as fp:
            files_to_copy[apk_key] = fp.read()
        print(f"Replaced {apk_key} ({len(files_to_copy[apk_key])} bytes)")
    else:
        print(f"Missing replacement: {local_path}")

print("[3/5] Packaging APK...")
if os.path.exists(TEMP_APK):
    os.remove(TEMP_APK)

with zipfile.ZipFile(TEMP_APK, "w", zipfile.ZIP_DEFLATED) as z_out:
    for fname, data in files_to_copy.items():
        if fname.endswith(".arsc"):
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
    print(f"Sign it with : java -jar \"{SIGNER_JAR}\" -a \"{TEMP_APK}\" -o \"{FINAL_DIR}\" --allowResign")
    print('Your own key : add --ks my.jks --ksAlias alias --ksPass pass --ksKeyPass pass')
    sys.exit(0)

print("[4/5] Aligning and signing with uber-apk-signer...")
os.makedirs(FINAL_DIR, exist_ok=True)
cmd = [JAVA_EXE, "-jar", SIGNER_JAR, "-a", TEMP_APK, "-o", FINAL_DIR, "--allowResign"]
res = subprocess.run(cmd, capture_output=True, text=True)
print(res.stdout)
if res.returncode != 0:
    print("Signing error:", res.stderr)
else:
    print("[5/5] Copying final Audenic.apk to Desktop and workspace...")
    signed_apk = os.path.join(FINAL_DIR, "audenic_unsigned-aligned-debugSigned.apk")
    if not os.path.exists(signed_apk):
        candidates = [f for f in os.listdir(FINAL_DIR) if f.lower().endswith(".apk")]
        signed_apk = os.path.join(FINAL_DIR, candidates[0]) if candidates else signed_apk

    if os.path.exists(signed_apk):
        print()
        verify_apk(signed_apk, label="signed APK")
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
    else:
        print("Could not find a signed APK in", FINAL_DIR)
