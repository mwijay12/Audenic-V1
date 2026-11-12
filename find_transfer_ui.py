import os

for root, dirs, files in os.walk(r"C:\Users\Administrator\Desktop\LARK\work\decoded"):
    for f in files:
        if f.endswith(".smali"):
            p = os.path.join(root, f)
            with open(p, "r", encoding="utf-8", errors="ignore") as fp:
                txt = fp.read()
                if "transfer/main" in txt and "SchemeMapImpl.smali" not in p:
                    print("Found transfer/main in:", p)
