import subprocess, os
from PIL import Image

OUT_DIR = r"C:\Users\Administrator\Desktop\LARK"
EDGE_EXE = r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if not os.path.exists(EDGE_EXE):
    EDGE_EXE = r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"

# 1. HTML for 48x48 Status Bar Icon (Pure white silhouette with alpha)
stat_html = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 48px;
    height: 48px;
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
  svg {
    width: 44px;
    height: 44px;
  }
</style>
</head>
<body>
<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Soundwave bar left -->
  <rect x="4" y="16" width="3.5" height="16" rx="1.75" fill="#FFFFFF"/>
  <rect x="10" y="10" width="3.5" height="28" rx="1.75" fill="#FFFFFF"/>
  
  <!-- Stylized Audenic 'A' -->
  <path d="M24 6L15 38H20.5L22.5 31H25.5L27.5 38H33L24 6ZM24 16.5L25.2 26H22.8L24 16.5Z" fill="#FFFFFF"/>
  
  <!-- Soundwave bar right -->
  <rect x="34.5" y="10" width="3.5" height="28" rx="1.75" fill="#FFFFFF"/>
  <rect x="40.5" y="16" width="3.5" height="16" rx="1.75" fill="#FFFFFF"/>
</svg>
</body>
</html>
"""

# 2. HTML for 144x144 Notification Cover (Crisp neon artwork)
cover_html = """<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 144px;
    height: 144px;
    background: #0b0e17;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 20px;
    border: 2px solid rgba(77, 238, 200, 0.4);
    box-shadow: inset 0 0 20px rgba(77, 238, 200, 0.2);
    overflow: hidden;
  }
  svg {
    width: 120px;
    height: 120px;
  }
</style>
</head>
<body>
<svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
  <!-- Ambient glow circle -->
  <circle cx="60" cy="60" r="45" fill="url(#neonGlow)" opacity="0.25"/>
  <defs>
    <radialGradient id="neonGlow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#4deec8" stop-opacity="1"/>
      <stop offset="100%" stop-color="#4deec8" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="neonGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7df9ff"/>
      <stop offset="50%" stop-color="#4deec8"/>
      <stop offset="100%" stop-color="#00b4d8"/>
    </linearGradient>
  </defs>

  <!-- Soundwave bars left -->
  <rect x="12" y="44" width="6" height="32" rx="3" fill="#4deec8" opacity="0.6"/>
  <rect x="24" y="30" width="6" height="60" rx="3" fill="#4deec8" opacity="0.85"/>
  
  <!-- Audenic Geometric A Monogram -->
  <path d="M60 16L38 88H49L54.5 70H65.5L71 88H82L60 16ZM60 38L63.5 58H56.5L60 38Z" fill="url(#neonGrad)"/>
  
  <!-- Soundwave bars right -->
  <rect x="90" y="30" width="6" height="60" rx="3" fill="#4deec8" opacity="0.85"/>
  <rect x="102" y="44" width="6" height="32" rx="3" fill="#4deec8" opacity="0.6"/>
</svg>
</body>
</html>
"""

stat_html_path = os.path.join(OUT_DIR, "stat_icon.html")
cover_html_path = os.path.join(OUT_DIR, "cover_icon.html")

with open(stat_html_path, "w", encoding="utf-8") as f:
    f.write(stat_html)

with open(cover_html_path, "w", encoding="utf-8") as f:
    f.write(cover_html)

def render_edge(html_file, out_png, width, height):
    tmp_out = out_png + ".raw.png"
    cmd = [
        EDGE_EXE,
        "--headless=new",
        f"--window-size={width},{height}",
        "--hide-scrollbars",
        "--default-background-color=00000000",
        f"--screenshot={tmp_out}",
        html_file
    ]
    subprocess.run(cmd, check=True)
    im = Image.open(tmp_out)
    im = im.crop((0, 0, width, height))
    im.save(out_png)
    os.remove(tmp_out)
    print(f"Rendered {out_png} ({width}x{height})")

stat_png = os.path.join(OUT_DIR, "ic_stat_audenic.png")
cover_png = os.path.join(OUT_DIR, "ic_notification_cover_audenic.png")

render_edge(stat_html_path, stat_png, 48, 48)
render_edge(cover_html_path, cover_png, 144, 144)
print("Notification icons successfully generated!")
