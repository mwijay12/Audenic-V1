for path in [r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\o\f16.smali", r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\o\sv5.smali"]:
    with open(path, "r", encoding="utf-8") as fp:
        lines = fp.readlines()
        print("===", path, "===")
        for i, l in enumerate(lines):
            if "transfer/main" in l:
                for j in range(max(0, i-3), min(len(lines), i+8)):
                    print(lines[j], end="")
