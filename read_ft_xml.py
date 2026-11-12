import os

for root, dirs, files in os.walk(r"C:\Users\Administrator\Desktop\LARK\work\decoded\res"):
    if "fragment_file_transfer.xml" in files:
        p = os.path.join(root, "fragment_file_transfer.xml")
        print("Found layout:", p)
        with open(p, "r", encoding="utf-8") as fp:
            print(fp.read()[:2000])
