from PIL import Image

im = Image.open(r"C:\Users\Administrator\Desktop\LARK\header_preview.png")
print("Size:", im.size)
# find non-transparent pixels with x > 120
pixels = []
for y in range(im.size[1]):
    for x in range(120, im.size[0]):
        r, g, b, a = im.getpixel((x, y))
        if a > 0:
            pixels.append((x, y, r, g, b, a))
print("Non-transparent pixels in text area (x > 120):", len(pixels))
if pixels:
    min_x = min(p[0] for p in pixels)
    max_x = max(p[0] for p in pixels)
    min_y = min(p[1] for p in pixels)
    max_y = max(p[1] for p in pixels)
    print(f"Bounding box: x={min_x}..{max_x}, y={min_y}..{max_y} (w={max_x - min_x}, h={max_y - min_y})")
