import xml.etree.ElementTree as ET

tree = ET.parse(r"C:\Users\Administrator\Desktop\LARK\main_ui.xml")
for n in tree.iter("node"):
    if n.attrib.get("clickable") == "true":
        rid = n.attrib.get("resource-id", "")
        txt = n.attrib.get("text", "")
        desc = n.attrib.get("content-desc", "")
        bounds = n.attrib.get("bounds", "")
        print(f"{rid:45} | text='{txt:12}' | desc='{desc:10}' | {bounds}")
