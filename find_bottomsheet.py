import os

for root, dirs, files in os.walk(r"C:\Users\Administrator\Desktop\LARK\work\decoded"):
    for f in files:
        if f.endswith(".smali"):
            p = os.path.join(root, f)
            with open(p, "r", encoding="utf-8", errors="ignore") as fp:
                txt = fp.read()
                if "MusicImportEntryBottomSheet" in txt and "MusicImportEntryBottomSheet.smali" not in p and "o\\sv5.smali" not in p:
                    print("Found MusicImportEntryBottomSheet in:", p)
