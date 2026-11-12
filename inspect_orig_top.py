import zipfile, io, json

with zipfile.ZipFile(r"C:\Users\Administrator\Desktop\LARK\Lark_Player.zip", "r") as z:
    d = z.read("assets/top.lottie")
    with zipfile.ZipFile(io.BytesIO(d)) as lz:
        print("top.lottie namelist:", lz.namelist())
        manifest = json.loads(lz.read("manifest.json"))
        print("top.lottie manifest:", manifest)
        main_json = json.loads(lz.read("animations/main.json"))
        print(f"w={main_json.get('w')}, h={main_json.get('h')}, fr={main_json.get('fr')}, ip={main_json.get('ip')}, op={main_json.get('op')}")
