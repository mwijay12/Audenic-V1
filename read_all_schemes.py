p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\scheme\api\SchemeMapImpl.smali"
with open(p, "r", encoding="utf-8") as fp:
    for line in fp:
        if "const-string v" in line and "://" in line:
            print(line.strip())
