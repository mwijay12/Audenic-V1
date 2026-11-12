p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\web\ui\WebViewActivity.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i, l in enumerate(lines):
    if "loadUrl" in l or "http" in l or "can't reach" in l.lower() or "server" in l.lower():
        for j in range(max(0, i - 5), min(len(lines), i + 8)):
            print(f"{j}: {lines[j].strip()}")
        print("---")
