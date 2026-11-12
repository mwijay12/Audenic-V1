import xml.etree.ElementTree as ET, sys

path = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\Administrator\Desktop\LARK\uidump_chrome2.xml'
tree = ET.parse(path)
for node in tree.iter('node'):
    text = node.attrib.get('text', '')
    desc = node.attrib.get('content-desc', '')
    if text or desc:
        print(f'text="{text}" | desc="{desc}"')
