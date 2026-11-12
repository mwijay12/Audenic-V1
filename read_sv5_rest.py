p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\o\sv5.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i, l in enumerate(lines[58:85]):
    print(f"{58+i}: {l.strip()}")
