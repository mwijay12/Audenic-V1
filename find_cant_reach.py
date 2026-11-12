import os

for root, dirs, files in os.walk(r"C:\Users\Administrator\Desktop\LARK\work\decoded"):
    for f in files:
        if f.endswith(".xml") or f.endswith(".smali"):
            p = os.path.join(root, f)
            with open(p, "r", encoding="utf-8", errors="ignore") as fp:
                txt = fp.read()
                if "Can’t reach the server" in txt or "reach the server" in txt:
                    print("Found error text in:", p)
