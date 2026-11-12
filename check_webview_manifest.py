with open(r"C:\Users\Administrator\Desktop\LARK\work\decoded\AndroidManifest.xml", "r", encoding="utf-8") as fp:
    txt = fp.read()

import re
matches = re.findall(r'<activity[^>]+WebViewActivity[^>]*>.*?</activity>', txt, re.DOTALL)
for m in matches:
    print("=== Activity ===")
    print(m)
