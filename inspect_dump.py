import xml.etree.ElementTree as ET, sys

path = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\Administrator\Desktop\LARK\uidump_newtabs.xml'
tree = ET.parse(path)
for node in tree.iter('node'):
    rid = node.attrib.get('resource-id', '')
    text = node.attrib.get('text', '')
    bounds = node.attrib.get('bounds', '')
    if any(k in rid for k in ['btn', 'anim', 'tab', 'chip', 'search']):
        print(f'{rid} | "{text}" | {bounds}')
