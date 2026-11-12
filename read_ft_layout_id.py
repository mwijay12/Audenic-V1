p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes4\com\dywx\larkplayer\R$layout.smali"
with open(p, "r", encoding="utf-8") as fp:
    for line in fp:
        if "fragment_file_transfer" in line:
            print(line.strip())
