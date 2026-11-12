import zipfile, io, json

with zipfile.ZipFile(r"C:\Users\Administrator\Desktop\LARK\Lark_Player.zip", "r") as z:
    d = z.read("assets/reply_en.lottie")
    with zipfile.ZipFile(io.BytesIO(d)) as lz:
        anim = json.loads(lz.read("animations/main.json"))
        for a in anim.get("assets", []):
            print(f"Asset id='{a.get('id')}', nm='{a.get('nm')}'")
            if "layers" in a:
                for l in a["layers"]:
                    print(f"   sublayer: {l.get('nm')}")
