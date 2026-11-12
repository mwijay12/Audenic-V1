with open(r"C:\Users\Administrator\Desktop\LARK\AndroidManifest.xml", "r", encoding="utf-8") as fp:
    txt = fp.read()

import re
matches = re.findall(r'<activity[^>]+android:name="([^"]+)"', txt)
for m in matches[:30]:
    print(m)
print("Total activities:", len(matches))
