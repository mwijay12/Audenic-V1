p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes4\com\dywx\larkplayer\module\base\widget\MainHeadView.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i, l in enumerate(lines):
    if ".method public final t()V" in l or ".method private final t()V" in l:
        for j in range(i, min(len(lines), i + 35)):
            print(lines[j], end="")
