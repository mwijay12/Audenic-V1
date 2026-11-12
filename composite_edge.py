from PIL import Image

im = Image.open(r"C:\Users\Administrator\Desktop\LARK\edge_header.png")
bg = Image.new("RGBA", im.size, (11, 14, 23, 255))
bg.paste(im, (0, 0), im)
bg.save(r"C:\Users\Administrator\Desktop\LARK\edge_dark.png")
print("Saved edge_dark.png")
