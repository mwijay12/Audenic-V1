import os

for root, dirs, files in os.walk(r"C:\Users\Administrator\Desktop\LARK\work\decoded\res"):
    for f in files:
        if f.endswith(".xml"):
            path = os.path.join(root, f)
            with open(path, "r", encoding="utf-8", errors="ignore") as fp:
                txt = fp.read()
                if "anim_title" in txt:
                    print("Found in XML:", path)
