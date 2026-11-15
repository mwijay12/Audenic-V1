"""Guards the build's Studio verification, ARSC rebranding, and branding assets.

    python3 tests/build_verify_test.py

Builds stand-in APKs in a temp directory and checks that `build_audenic.py
--verify` accepts a current Studio and rejects stale, incomplete or broken ones,
plus checks UTF-8 ResStringPool rebuilding and tracked branding assets.
"""

import os
import struct
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "assets", "transfer_web")
BUILDER = os.path.join(ROOT, "build_audenic.py")

sys.path.insert(0, ROOT)
import build_audenic  # noqa: E402


def make_apk(path, drop=None, tamper=None, extra=None):
    with zipfile.ZipFile(path, "w") as archive:
        for base, _dirs, files in os.walk(WEB):
            for name in files:
                if name in build_audenic.STUDIO_EXCLUDE:
                    continue
                full = os.path.join(base, name)
                key = "assets/transfer_web/" + os.path.relpath(full, WEB).replace("\\", "/")
                if key == drop:
                    continue
                data = open(full, "rb").read()
                if key == tamper:
                    data += b"\n<!-- stale build -->"
                archive.writestr(key, data)
        if extra:
            archive.writestr(extra[0], extra[1])


def make_minimal_arsc(strings, style_count=0):
    sp_blob = bytearray()
    offsets = []
    for text in strings:
        offsets.append(len(sp_blob))
        sp_blob.extend(build_audenic._encode_utf8_entry(text))
    while len(sp_blob) % 4 != 0:
        sp_blob.append(0)

    sp_hdr = 28
    strings_start = sp_hdr + 4 * len(strings)
    sp_size = strings_start + len(sp_blob)
    sp = struct.pack(
        "<HHIIIIII",
        0x0001,
        sp_hdr,
        sp_size,
        len(strings),
        style_count,
        0x100,
        strings_start,
        0,
    )
    sp += struct.pack(f"<{len(strings)}I", *offsets) + bytes(sp_blob)
    pkg = struct.pack("<HHI", 0x0200, 12, 12) + b"\x00" * 0
    rt = struct.pack("<HHII", 0x0002, 12, 12 + len(sp) + len(pkg), 1)
    return rt + sp + pkg


def verify(path):
    result = subprocess.run(
        [sys.executable, BUILDER, "--verify", path],
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout


def main():
    checks = 0
    failures = []

    with tempfile.TemporaryDirectory() as tmp:
        current = os.path.join(tmp, "current.apk")
        make_apk(current, extra=("classes.dex", b"not-a-real-dex"))
        code, out = verify(current)
        checks += 1
        if code != 0 or "OK" not in out:
            failures.append("current Studio should verify")

        stale = os.path.join(tmp, "stale.apk")
        make_apk(stale, tamper="assets/transfer_web/index.html")
        code, out = verify(stale)
        checks += 1
        if code != 1 or "MISMATCH" not in out:
            failures.append("tampered index.html should be rejected")

        incomplete = os.path.join(tmp, "incomplete.apk")
        make_apk(incomplete, drop="assets/transfer_web/index.html")
        code, out = verify(incomplete)
        checks += 1
        if code != 1 or "missing" not in out.lower():
            failures.append("missing index.html should be reported")

        broken = os.path.join(tmp, "broken.apk")
        with open(broken, "wb") as handle:
            handle.write(b"definitely not a zip")
        code, out = verify(broken)
        checks += 1
        if code != 1 or "not a valid" not in out:
            failures.append("a non-zip should be rejected")

        code, out = verify(os.path.join(tmp, "absent.apk"))
        checks += 1
        if code != 1 or "not found" not in out:
            failures.append("an absent file should be reported")

        # --doctor must report Studio and branding assets
        doctor = subprocess.run(
            [sys.executable, BUILDER, "--doctor"], capture_output=True, text=True
        )
        checks += 1
        if "Studio" not in doctor.stdout or "index.html" not in doctor.stdout or "Branding" not in doctor.stdout:
            failures.append("doctor should print the resolved Studio and branding count")

        # ARSC string pool rebuilding handles longer strings and preserves technical IDs
        arsc_strings = [
            "styled_lark_skip",
            "Welcome to Lark Player",
            "Furahia mchezaji wa lark?",
            "lark-player-e4548.appspot.com",
            "res/raw/welcome_to_lark_player.m4a",
        ]
        raw_arsc = make_minimal_arsc(arsc_strings, style_count=1)
        patched_arsc, patched_cnt, _ = build_audenic.patch_resources_arsc(raw_arsc)
        rt_type, rt_hdr, rt_size, _ = struct.unpack_from("<HHII", patched_arsc, 0)
        ct, ch, cs = struct.unpack_from("<HHI", patched_arsc, rt_hdr)
        sc, _stc, _fl, ss, _sts = struct.unpack_from("<IIIII", patched_arsc, rt_hdr + 8)
        offs = struct.unpack_from(f"<{sc}I", patched_arsc, rt_hdr + ch)
        decoded = [build_audenic._decode_utf8_at(patched_arsc, rt_hdr + ss + o) for o in offs]
        checks += 1
        if (
            rt_size != len(patched_arsc)
            or patched_cnt != 2
            or decoded[0] != "styled_lark_skip"
            or decoded[1] != "Welcome to Audenic"
            or decoded[2] != "Furahia mchezaji wa audenic?"
            or decoded[3] != "lark-player-e4548.appspot.com"
            or decoded[4] != "res/raw/welcome_to_lark_player.m4a"
        ):
            failures.append(f"ARSC rebuild failed: {decoded}")

        # All 18 branding assets must exist in the repo
        branding = build_audenic._resolve_branding_assets()
        missing_branding = [k for k, p in branding.items() if not os.path.isfile(p)]
        checks += 1
        if missing_branding:
            failures.append(f"missing branding assets: {missing_branding}")

    for failure in failures:
        print(f"  FAIL  {failure}")
    print(f"\n{checks - len(failures)} / {checks} build checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
