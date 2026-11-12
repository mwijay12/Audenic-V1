p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\scheme\api\SchemeMapImpl.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i, l in enumerate(lines):
    if "larkplayer://h5/normal" in l:
        for j in range(max(0, i - 5), min(len(lines), i + 10)):
            print(lines[j], end="")
