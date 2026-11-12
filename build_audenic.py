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
"""

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
WORK_BUILD = os.path.join(ROOT, "work", "decoded", "build", "apk")
WEB_TRANSFER = os.environ.get("AUDENIC_WEB_DIR") or os.path.join(HERE, "assets", "transfer_web")
if not os.path.isdir(WEB_TRANSFER):
    WEB_TRANSFER = os.path.join(ROOT, "assets", "transfer_web")
TEMP_APK = os.path.join(ROOT, "audenic_unsigned.apk")
FINAL_DIR = os.environ.get("AUDENIC_OUT") or os.path.join(ROOT, "dist")
JAVA_EXE = os.environ.get("AUDENIC_JAVA") or r"C:\Users\Administrator\AppData\Local\Temp\opencode\tools\jdk\jdk-21.0.13+9\bin\java.exe"
SIGNER_JAR = os.environ.get("AUDENIC_SIGNER") or r"C:\Users\Administrator\AppData\Local\Temp\opencode\tools\uber-apk-signer.jar"
AUDENIC_LOTTIE = os.path.join(ROOT, "test_audenic.lottie")
GEN_LOTTIE_SCRIPT = os.path.join(ROOT, "generate_audenic_lottie.py")


def _preflight():
    missing = []
    if not os.path.isfile(LARK_ZIP):
        missing.append(f"source APK: {LARK_ZIP}")
    if not os.path.isdir(WEB_TRANSFER):
        missing.append(f"Studio assets: {WEB_TRANSFER}")
    if not os.path.isfile(SIGNER_JAR):
        missing.append(f"uber-apk-signer: {SIGNER_JAR}")
    if not os.path.isfile(JAVA_EXE):
        missing.append(f"java: {JAVA_EXE}")
    if missing:
        print("Cannot build — missing inputs:")
        for item in missing:
            print(f"  - {item}")
        print("\nOverride paths with AUDENIC_ROOT, AUDENIC_SOURCE_APK, AUDENIC_WEB_DIR,")
        print("AUDENIC_JAVA and AUDENIC_SIGNER.")
        sys.exit(1)


_preflight()

print(f"Source APK : {LARK_ZIP}")
print(f"Studio     : {WEB_TRANSFER}")
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
MODIFIED_DEX4 = r"C:\Users\Administrator\Desktop\LARK\dex_out\classes4.dex"
if os.path.exists(MODIFIED_DEX4):
    with open(MODIFIED_DEX4, "rb") as fp:
        files_to_copy["classes4.dex"] = fp.read()
    print(f"Replaced classes4.dex ({len(files_to_copy['classes4.dex'])} bytes) with Full-Screen Audenic launcher")

MODIFIED_DEX5 = r"C:\Users\Administrator\Desktop\LARK\dex_out\classes5.dex"
if os.path.exists(MODIFIED_DEX5):
    with open(MODIFIED_DEX5, "rb") as fp:
        files_to_copy["classes5.dex"] = fp.read()
    print(f"Replaced classes5.dex ({len(files_to_copy['classes5.dex'])} bytes)")

# Override web transfer files with Audenic AI Studio
web_file_count = 0
for root, dirs, files in os.walk(WEB_TRANSFER):
    for f in files:
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
    "res/drawable-xhdpi-v4/ic_stat_larkplayer.png": r"C:\Users\Administrator\Desktop\LARK\ic_stat_audenic.png",
    "res/drawable-xxhdpi-v4/ic_notification_default_cover.png": r"C:\Users\Administrator\Desktop\LARK\ic_notification_cover_audenic.png",
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
        targets = [os.path.join(ROOT, "Audenic.apk")]
        desktop = os.path.join(os.path.expanduser("~"), "Desktop")
        if os.path.isdir(desktop):
            targets.append(os.path.join(desktop, "Audenic.apk"))

        print("SUCCESS! Final signed Audenic APK is ready:")
        for target in targets:
            try:
                shutil.copy2(signed_apk, target)
                print(f"  -> {target} ({os.path.getsize(target)} bytes)")
            except OSError as error:
                print(f"  -> skipped {target}: {error}")
    else:
        print("Could not find a signed APK in", FINAL_DIR)
