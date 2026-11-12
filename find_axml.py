import zipfile

with zipfile.ZipFile("Lark_Player.zip", "r") as z:
    axml = z.read("AndroidManifest.xml")

print("AXML length:", len(axml))
# Search for WebViewActivity in AXML string pool
idx = axml.find(b"com.dywx.v4.web.ui.WebViewActivity")
print("Found WebViewActivity at:", idx)
