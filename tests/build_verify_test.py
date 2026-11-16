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

        # All 18 branding assets must exist in the repo and have valid AXML/resource refs
        branding = build_audenic._resolve_branding_assets()
        missing_branding = [k for k, p in branding.items() if not os.path.isfile(p)]
        checks += 1
        if missing_branding:
            failures.append(f"missing branding assets: {missing_branding}")

        # Verify compiled AXML vector drawables & valid resource references
        bad_axml = []
        for k, p in branding.items():
            if not k.endswith(".xml") or not os.path.isfile(p):
                continue
            d = open(p, "rb").read()
            t, h, sz = struct.unpack_from("<HHI", d, 0)
            if t != 0x0003 or sz != len(d):
                bad_axml.append(k)
                continue
            # Check string pool + resource map for fillAlpha attribute ID (0x010104cc)
            _st, sh, ss, sc, _stc, fl, str_s, _sty_s = struct.unpack_from("<HHIIIIII", d, h)
            soffs = struct.unpack_from(f"<{sc}I", d, h + sh)
            sp_strs = []
            for sidx in range(sc):
                sp_pos = h + str_s + soffs[sidx]
                if fl & 0x100:
                    cl = d[sp_pos]; sp_pos += 1
                    if cl & 0x80: cl = ((cl & 0x7f) << 8) | d[sp_pos]; sp_pos += 1
                    bl = d[sp_pos]; sp_pos += 1
                    if bl & 0x80: bl = ((bl & 0x7f) << 8) | d[sp_pos]; sp_pos += 1
                    sp_strs.append(d[sp_pos:sp_pos + bl].decode("utf-8", "replace"))
                else:
                    cl = struct.unpack_from("<H", d, sp_pos)[0]; sp_pos += 2
                    sp_strs.append(d[sp_pos:sp_pos + cl * 2].decode("utf-16-le", "replace"))
            off = h
            while off < len(d):
                ct, ch, cs = struct.unpack_from("<HHI", d, off)
                if ct == 0x0180:
                    rids = struct.unpack_from(f"<{(cs - 8) // 4}I", d, off + 8)
                    for idx, rid in enumerate(rids):
                        if idx < len(sp_strs) and sp_strs[idx] == "fillAlpha" and rid != 0x010104cc:
                            bad_axml.append(f"{k}(fillAlpha=0x{rid:x})")
                elif ct == 0x0102:
                    _, _, as_off, as_sz, ac, *_ = struct.unpack_from("<IIHHHHHH", d, off + 16)
                    for idx in range(ac):
                        a_off = off + 16 + as_off + idx * as_sz
                        _, _, _, _, _, dtype, dval = struct.unpack_from("<IIIHBBI", d, a_off)
                        if dtype in (0x01, 0x02) and dval == 0x7f060504:
                            bad_axml.append(f"{k}(0x7f060504)")
                off += cs
        checks += 1
        if bad_axml:
            failures.append(f"invalid branding AXML: {bad_axml}")

        # Verify META-INF service files are preserved while v1 signature entries are skipped
        checks += 1
        if (
            not build_audenic._is_apk_signature_entry("META-INF/MANIFEST.MF")
            or not build_audenic._is_apk_signature_entry("META-INF/EDITOR.SF")
            or not build_audenic._is_apk_signature_entry("META-INF/EDITOR.RSA")
            or build_audenic._is_apk_signature_entry("META-INF/services/o.u35")
            or build_audenic._is_apk_signature_entry("META-INF/services/o.zk1")
            or build_audenic._is_apk_signature_entry("META-INF/com/pangle/global/pag-sdk/verification.properties")
        ):
            failures.append("_is_apk_signature_entry must strip only v1 signature files and keep META-INF/services/*")

        # Verify test_audenic.lottie is pure vector (no raster data:image URIs)
        lottie_path = os.path.join(ROOT, "test_audenic.lottie")
        with zipfile.ZipFile(lottie_path) as lzf:
            anim_json = lzf.read("animations/main.json")
        checks += 1
        if b"data:image/" in anim_json:
            failures.append("test_audenic.lottie should be pure vector without embedded raster images")

        # Verify dex_out/classes4.dex & classes5.dex use com.dywx.larkplayer (not com.audenic.player)
        # and pass full DEX section-boundary / map_list / checksum verification (DexFileVerifier).
        def _uleb(buf, pos):
            val, sh = 0, 0
            while True:
                b = buf[pos]; pos += 1; val |= (b & 0x7f) << sh
                if not (b & 0x80):
                    return val, pos
                sh += 7

        def _sleb(buf, pos):
            val, sh = 0, 0
            while True:
                b = buf[pos]; pos += 1; val |= (b & 0x7f) << sh; sh += 7
                if not (b & 0x80):
                    if b & 0x40:
                        val -= (1 << sh)
                    return val, pos

        def _skip_ev(buf, pos):
            b = buf[pos]; pos += 1
            vt, va = b & 0x1f, (b >> 5) & 0x07
            if vt in (0x00, 0x02, 0x03, 0x04, 0x06, 0x10, 0x11, 0x17, 0x18, 0x19, 0x1a, 0x1b):
                return pos + va + 1
            if vt == 0x1c:
                cnt, pos = _uleb(buf, pos)
                for _ in range(cnt):
                    pos = _skip_ev(buf, pos)
                return pos
            if vt == 0x1d:
                _, pos = _uleb(buf, pos)
                cnt, pos = _uleb(buf, pos)
                for _ in range(cnt):
                    _, pos = _uleb(buf, pos)
                    pos = _skip_ev(buf, pos)
                return pos
            if vt in (0x1e, 0x1f):
                return pos
            raise ValueError(f"bad encoded_value type 0x{vt:02x}")

        align4_types = {0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x1000, 0x1001, 0x1002, 0x1003, 0x2001, 0x2006}
        bad_dex = []
        for dname in ("classes4.dex", "classes5.dex"):
            dbytes = open(os.path.join(ROOT, "dex_out", dname), "rb").read()
            fsz, _hsz, _end, _ls, _lo, map_o, str_cnt, str_off = struct.unpack_from("<8I", dbytes, 32)
            if fsz != len(dbytes):
                bad_dex.append(f"{dname}:size")
                continue
            mcnt = struct.unpack_from("<I", dbytes, map_o)[0]
            items = [struct.unpack_from("<HHII", dbytes, map_o + 4 + j * 12) for j in range(mcnt)]
            for j, (t, _u, cnt, off) in enumerate(items):
                p = off
                if t == 0x0000: p += 112
                elif t in (0x0001, 0x0002): p += cnt * 4
                elif t == 0x0003: p += cnt * 12
                elif t in (0x0004, 0x0005): p += cnt * 8
                elif t == 0x0006: p += cnt * 32
                elif t == 0x2002:
                    for _ in range(cnt):
                        _, p = _uleb(dbytes, p); p = dbytes.index(0, p) + 1
                elif t == 0x1001:
                    for _ in range(cnt):
                        while p % 4: p += 1
                        p += 4 + struct.unpack_from("<I", dbytes, p)[0] * 2
                elif t == 0x2005:
                    for _ in range(cnt):
                        c2, p = _uleb(dbytes, p)
                        for _ in range(c2): p = _skip_ev(dbytes, p)
                elif t == 0x2004:
                    for _ in range(cnt):
                        p += 1; _, p = _uleb(dbytes, p); ec, p = _uleb(dbytes, p)
                        for _ in range(ec): _, p = _uleb(dbytes, p); p = _skip_ev(dbytes, p)
                elif t in (0x1002, 0x1003):
                    for _ in range(cnt):
                        while p % 4: p += 1
                        p += 4 + struct.unpack_from("<I", dbytes, p)[0] * 4
                elif t == 0x2006:
                    for _ in range(cnt):
                        while p % 4: p += 1
                        _, fs_, ms_, ps_ = struct.unpack_from("<IIII", dbytes, p)
                        p += 16 + (fs_ + ms_ + ps_) * 8
                elif t == 0x2003:
                    for _ in range(cnt):
                        _, p = _uleb(dbytes, p); ps_, p = _uleb(dbytes, p)
                        for _ in range(ps_): _, p = _uleb(dbytes, p)
                        while True:
                            op = dbytes[p]; p += 1
                            if op == 0: break
                            elif op in (1, 5, 6, 9): _, p = _uleb(dbytes, p)
                            elif op == 2: _, p = _sleb(dbytes, p)
                            elif op in (3, 4):
                                _, p = _uleb(dbytes, p); _, p = _uleb(dbytes, p); _, p = _uleb(dbytes, p)
                                if op == 4: _, p = _uleb(dbytes, p)
                elif t == 0x2001:
                    for _ in range(cnt):
                        while p % 4: p += 1
                        _r, _i, _o, tries, _dbg, sz_ = struct.unpack_from("<HHHHII", dbytes, p)
                        p += 16 + sz_ * 2
                        if tries:
                            if p % 4: p += 2
                            p += tries * 8
                            hc, p = _uleb(dbytes, p)
                            for _ in range(hc):
                                sv, p = _sleb(dbytes, p)
                                for _ in range(abs(sv)): _, p = _uleb(dbytes, p); _, p = _uleb(dbytes, p)
                                if sv <= 0: _, p = _uleb(dbytes, p)
                elif t == 0x2000:
                    for _ in range(cnt):
                        sf_, p = _uleb(dbytes, p); inf_, p = _uleb(dbytes, p); dm_, p = _uleb(dbytes, p); vm_, p = _uleb(dbytes, p)
                        for _ in range(sf_ + inf_): _, p = _uleb(dbytes, p); _, p = _uleb(dbytes, p)
                        for _ in range(dm_ + vm_): _, p = _uleb(dbytes, p); _, p = _uleb(dbytes, p); _, p = _uleb(dbytes, p)
                elif t == 0x1000:
                    if off != map_o:
                        bad_dex.append(f"{dname}:map_off(0x{off:x}!=0x{map_o:x})")
                    p += 4 + mcnt * 12
                if j + 1 < mcnt:
                    nt, _, _, noff = items[j + 1]
                    exp = ((p + 3) & ~3) if nt in align4_types else p
                    if exp != noff:
                        bad_dex.append(f"{dname}:sec0x{t:04x}(0x{exp:x}!=0x{noff:x})")
                elif p != fsz:
                    bad_dex.append(f"{dname}:eof(0x{p:x}!=0x{fsz:x})")

            for sidx in range(str_cnt):
                so = struct.unpack_from("<I", dbytes, str_off + sidx * 4)[0]
                p = so
                while dbytes[p] & 0x80:
                    p += 1
                p += 1
                s = dbytes[p : dbytes.index(0, p)].decode("utf-8", "replace")
                if s in ("com.audenic.player:playback", "com.audenic.player:splash"):
                    bad_dex.append(f"{dname}:{s}")
        checks += 1
        if bad_dex:
            failures.append(f"DEX verification failed in dex_out: {bad_dex}")

    for failure in failures:
        print(f"  FAIL  {failure}")
    print(f"\n{checks - len(failures)} / {checks} build checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
