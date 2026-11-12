import os

for root, dirs, files in os.walk(r"C:\Users\Administrator\Desktop\LARK\work\decoded\res\layout"):
    for f in files:
        path = os.path.join(root, f)
        with open(path, "r", encoding="utf-8", errors="ignore") as fp:
            txt = fp.read()
            if "anim_title" in txt or "7d070041" in txt or "@id/anim_title" in txt:
                print("Found in layout:", f)
