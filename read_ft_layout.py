p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\transfer\ui\FileTransferFragment.smali"
with open(p, "r", encoding="utf-8") as fp:
    for line in fp:
        if "R$layout" in line:
            print(line.strip())
