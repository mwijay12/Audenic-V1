import os

for root, dirs, files in os.walk(r"C:\Users\Administrator\Desktop\LARK\work\decoded"):
    for f in files:
        if f.endswith(".smali"):
            p = os.path.join(root, f)
            with open(p, "r", encoding="utf-8", errors="ignore") as fp:
                txt = fp.read()
                if "Lo/jg9;" in txt and p != r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\o\jg9.smali":
                    print("Found jg9 reference in:", p)
