with open(r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\o\f04.smali", "r", encoding="utf-8") as fp:
    lines = fp.readlines()

for i, l in enumerate(lines):
    if "MusicImportEntryBottomSheet" in l:
        for j in range(max(0, i-10), min(len(lines), i+15)):
            print(f"{j}: {lines[j].strip()}")
