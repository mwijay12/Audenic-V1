import xml.etree.ElementTree as ET

tree = ET.parse(r"C:\Users\Administrator\Desktop\LARK\settings_ui.xml")
for n in tree.iter("node"):
    txt = n.attrib.get("text", "")
    rid = n.attrib.get("resource-id", "")
    bounds = n.attrib.get("bounds", "")
    if txt or "setting" in rid:
        print(f"{rid:45} | text='{txt:25}' | {bounds}")
