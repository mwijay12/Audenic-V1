import zipfile, io, json

with zipfile.ZipFile(r"C:\Users\Administrator\Desktop\LARK\Lark_Player.zip", "r") as z:
    d = z.read("assets/top.lottie")
    with zipfile.ZipFile(io.BytesIO(d)) as lz:
        main_json = json.loads(lz.read("animations/main.json"))
        l1 = main_json["layers"][0]
        print(json.dumps(l1, indent=2)[:800])
