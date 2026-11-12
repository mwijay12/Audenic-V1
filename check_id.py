import os, re

p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes4\com\dywx\larkplayer\R$id.smali"
if os.path.exists(p):
    with open(p, "r", encoding="utf-8") as f:
        for line in f:
            if "anim_title" in line:
                print(line.strip())
else:
    print("Not found:", p)
