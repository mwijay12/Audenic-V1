import xml.etree.ElementTree as ET

tree = ET.parse(r'C:\Users\Administrator\Desktop\LARK\main_ui.xml')
for n in tree.iter('node'):
    text = n.attrib.get('text', '')
    rid = n.attrib.get('resource-id', '')
    bounds = n.attrib.get('bounds', '')
    cls = n.attrib.get('class', '')
    if any(k in text or k in rid for k in ['Lark', 'head', 'logo', 'title']):
        print(f"{rid} | {cls} | text='{text}' | {bounds}")
