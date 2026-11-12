import zipfile, io, json

with zipfile.ZipFile(r"C:\Users\Administrator\Desktop\LARK\Lark_Player.zip", "r") as z:
    d = z.read("assets/top.lottie")
    with zipfile.ZipFile(io.BytesIO(d)) as lz:
        anim = json.loads(lz.read("animations/main.json"))
        print("top.lottie assets count:", len(anim.get("assets", [])))
        for a in anim.get("assets", []):
            print(f"Asset id={a.get('id')}")
