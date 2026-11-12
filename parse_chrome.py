import xml.etree.ElementTree as ET

tree = ET.parse(r'C:\Users\Administrator\Desktop\LARK\uidump_chrome.xml')
for node in tree.iter('node'):
    text = node.attrib.get('text', '')
    desc = node.attrib.get('content-desc', '')
    if text or desc:
        print(f'text="{text}" | desc="{desc}"')
