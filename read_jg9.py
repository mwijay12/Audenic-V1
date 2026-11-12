p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\o\jg9.smali"
with open(p, "r", encoding="utf-8") as fp:
    for i, line in enumerate(fp):
        if i < 100:
            print(line, end="")
