with open(r"C:\Users\Administrator\Desktop\LARK\AndroidManifest.xml", "r", encoding="utf-8") as fp:
    txt = fp.read()

import re
matches = re.findall(r'<activity[^>]+name="([^"]*web[^"]*)"', txt, re.IGNORECASE)
print("Activities with web:", matches)
