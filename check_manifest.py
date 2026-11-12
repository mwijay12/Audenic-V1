with open(r"C:\Users\Administrator\Desktop\LARK\AndroidManifest.xml", "r", encoding="utf-8") as fp:
    txt = fp.read()

import re
matches = re.findall(r'<activity[^>]+WebViewActivity[^>]*>', txt, re.DOTALL)
for m in matches:
    print("Found activity:", m)
