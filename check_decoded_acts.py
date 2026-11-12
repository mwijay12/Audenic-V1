with open(r"C:\Users\Administrator\Desktop\LARK\work\decoded\AndroidManifest.xml", "r", encoding="utf-8") as fp:
    txt = fp.read()

import re
matches = re.findall(r'<activity[^>]+android:name="([^"]+)"', txt)
for m in matches:
    if "web" in m.lower() or "main" in m.lower() or "transfer" in m.lower():
        print("Match:", m)
