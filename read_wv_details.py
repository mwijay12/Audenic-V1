p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\web\ui\WebViewActivity.smali"
with open(p, "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i, l in enumerate(lines):
    if "onCreate" in l or "loadUrl" in l or "initView" in l:
        print(f"Line {i}: {l.strip()}")
