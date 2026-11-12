import os
from PIL import Image, ImageDraw, ImageFont

fonts = [
    r"C:\Windows\Fonts\arial.ttf",
    r"C:\Windows\Fonts\calibri.ttf",
    r"C:\Windows\Fonts\consola.ttf",
    r"C:\Windows\Fonts\segoeui.ttf",
    r"C:\Windows\Fonts\tahoma.ttf",
]
im = Image.new("RGB", (600, 300), (0, 0, 0))
draw = ImageDraw.Draw(im)
y = 10
for f in fonts:
    if os.path.exists(f):
        try:
            fnt = ImageFont.truetype(f, 32)
            draw.text((10, y), f"{os.path.basename(f)}: AUDENIC", font=fnt, fill=(255, 255, 255))
        except Exception as e:
            draw.text((10, y), f"{os.path.basename(f)}: ERROR {e}", fill=(255, 0, 0))
    else:
        draw.text((10, y), f"{os.path.basename(f)}: NOT FOUND", fill=(255, 255, 0))
    y += 45
im.save("font_test_all.png")
print("Saved font_test_all.png")
