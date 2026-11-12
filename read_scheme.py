p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\scheme\api\SchemeMapImpl.smali"
with open(p, "r", encoding="utf-8") as fp:
    for line in fp:
        if "FileTransferFragment" in line or "transfer" in line.lower():
            print(line.strip())
