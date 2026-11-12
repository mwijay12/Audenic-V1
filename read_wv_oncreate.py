p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\web\ui\WebViewActivity.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i in range(155, min(330, len(lines))):
    print(f"{i}: {lines[i].strip()}")
