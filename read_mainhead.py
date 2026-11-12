p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes4\com\dywx\larkplayer\module\base\widget\MainHeadView.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i, l in enumerate(lines[1540:1590]):
    print(f"{1540 + i}: {l.strip()}")
