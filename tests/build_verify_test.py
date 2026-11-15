"""Guards the build's Studio verification (no JDK, no APK required).

    python3 tests/build_verify_test.py

Builds stand-in APKs in a temp directory and checks that `build_audenic.py
--verify` accepts a current Studio and rejects stale, incomplete or broken ones.
"""

import os
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
WEB = os.path.join(ROOT, "assets", "transfer_web")
BUILDER = os.path.join(ROOT, "build_audenic.py")


def make_apk(path, drop=None, tamper=None, extra=None):
    with zipfile.ZipFile(path, "w") as archive:
        for base, _dirs, files in os.walk(WEB):
            for name in files:
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

        # --doctor must never claim readiness while the source APK is missing
        doctor = subprocess.run(
            [sys.executable, BUILDER, "--doctor"], capture_output=True, text=True
        )
        checks += 1
        if "Studio" not in doctor.stdout or "index.html" not in doctor.stdout:
            failures.append("doctor should print the resolved Studio")

    for failure in failures:
        print(f"  FAIL  {failure}")
    print(f"\n{checks - len(failures)} / {checks} build checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
