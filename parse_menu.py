import xml.etree.ElementTree as ET

tree = ET.parse(r'C:\Users\Administrator\Desktop\LARK\uidump_menu.xml')
for node in tree.iter('node'):
    text = node.attrib.get('text', '')
    rid = node.attrib.get('resource-id', '')
    if text:
        print(f'{rid} | "{text}"')
