p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes4\com\dywx\larkplayer\module\base\widget\MainHeadView.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i in range(1625, min(1665, len(lines))):
    print(f"{i}: {lines[i].strip()}")
