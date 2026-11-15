import base64
import json
import os
import shutil
import subprocess
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.environ.get("AUDENIC_ROOT") or HERE
HTML_PATH = os.path.join(ROOT, "header_render.html")
if not os.path.isfile(HTML_PATH):
    HTML_PATH = os.path.join(HERE, "header_render.html")
PNG_PATH = os.path.join(ROOT, "edge_header.png")
LOTTIE_OUT = os.path.join(ROOT, "test_audenic.lottie")


def _find_browser():
    for candidate in (
        os.environ.get("AUDENIC_BROWSER"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        shutil.which("msedge"),
        shutil.which("google-chrome"),
        shutil.which("chromium"),
        shutil.which("chromium-browser"),
    ):
        if candidate and os.path.isfile(candidate):
            return candidate
    return None


def main():
    browser = _find_browser()
    if not browser:
        raise FileNotFoundError(
            "No headless Chromium/Edge browser found to re-render header_render.html."
        )

    print(f"[1/3] Rendering high-craft Audenic header via {os.path.basename(browser)}...")
    subprocess.run([
        browser,
        "--headless=new",
        "--disable-gpu",
        "--default-background-color=00000000",
        "--window-size=582,168",
        f"--screenshot={PNG_PATH}",
        f"file:///{HTML_PATH.replace(os.sep, '/')}",
    ], check=True)

    print("[2/3] Reading rendered header PNG...")
    with open(PNG_PATH, "rb") as fp:
        b64_png = "data:image/png;base64," + base64.b64encode(fp.read()).decode("ascii")

    lottie_dict = {
        "v": "5.7.4",
        "fr": 30,
        "ip": 0,
        "op": 30,
        "w": 194,
        "h": 56,
        "nm": "Audenic Header",
        "ddd": 0,
        "assets": [
            {
                "id": "img_audenic",
                "w": 582,
                "h": 168,
                "u": "",
                "p": b64_png,
                "e": 1,
            }
        ],
        "layers": [
            {
                "ddd": 0,
                "ind": 1,
                "ty": 2,
                "nm": "Audenic Branding",
                "refId": "img_audenic",
                "sr": 1,
                "ks": {
                    "o": {"a": 0, "k": 100},
                    "r": {"a": 0, "k": 0},
                    "p": {"a": 0, "k": [97, 28, 0]},
                    "a": {"a": 0, "k": [291, 84, 0]},
                    "s": {"a": 0, "k": [33.333, 33.333, 100]},
                },
                "ao": 0,
                "ip": 0,
                "op": 30,
                "st": 0,
                "bm": 0,
            }
        ],
    }

    print("[3/3] Packing dotLottie container...")
    with zipfile.ZipFile(LOTTIE_OUT, "w", zipfile.ZIP_DEFLATED) as z:
        manifest = {
            "version": 1,
            "author": "Audenic",
            "generator": "Audenic High-Craft Engine",
            "animations": [{"id": "main"}],
        }
        z.writestr("manifest.json", json.dumps(manifest))
        z.writestr("animations/main.json", json.dumps(lottie_dict))

    print(f"Generated pixel-perfect Audenic Lottie: {LOTTIE_OUT} ({os.path.getsize(LOTTIE_OUT)} bytes)")


if __name__ == "__main__":
    main()
