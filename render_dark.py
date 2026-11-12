from PIL import Image

im = Image.open(r"C:\Users\Administrator\Desktop\LARK\header_preview.png")
bg = Image.new("RGBA", im.size, (11, 14, 23, 255)) # #0b0e17 dark theme
bg.paste(im, (0, 0), im)
bg.save(r"C:\Users\Administrator\Desktop\LARK\header_dark_preview.png")
print("Saved header_dark_preview.png")
