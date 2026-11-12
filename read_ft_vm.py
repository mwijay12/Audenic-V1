p = r"C:\Users\Administrator\Desktop\LARK\work\decoded\smali_classes5\com\dywx\larkplayer\feature\transfer\ui\FileTransferViewModel.smali"
with open(p, "r", encoding="utf-8") as fp:
    for line in fp:
        if "http" in line or "port" in line.lower() or "url" in line.lower() or "80" in line:
            print(line.strip())
