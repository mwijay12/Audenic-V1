import glob
import re

files = glob.glob(r'work\decoded\res\values*\strings.xml')
replaced_files = 0

for fp in files:
    with open(fp, 'r', encoding='utf-8', errors='ignore') as f:
        content = f.read()

    new_content = content
    new_content = re.sub(r'<string name="lp_name">.*?</string>', '<string name="lp_name">Audenic</string>', new_content)
    new_content = re.sub(r'<string name="title_base">.*?</string>', '<string name="title_base">Audenic</string>', new_content)
    new_content = new_content.replace('Mini Lark Player', 'Audenic Mini')
    new_content = new_content.replace('Lark Player ndogo', 'Audenic Ndogo')
    new_content = new_content.replace('Lark Player', 'Audenic')
    new_content = new_content.replace('LarkPlayer', 'Audenic')

    if new_content != content:
        with open(fp, 'w', encoding='utf-8') as f:
            f.write(new_content)
        replaced_files += 1

print(f"Replaced strings across {replaced_files} localized strings.xml files!")
