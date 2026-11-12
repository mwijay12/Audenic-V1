p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\web\ui\WebViewActivity.smali"
with open(p, "r", encoding="utf-8") as fp:
    for i, line in enumerate(fp):
        if "getStringExtra" in line or "getSerializableExtra" in line or "const-string" in line:
            if any(k in line for k in ["url", "URL", "title", "path", "loadUrl", "http"]):
                print(line.strip())
