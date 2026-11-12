import zipfile, io, json

with zipfile.ZipFile(r"C:\Users\Administrator\Desktop\LARK\Lark_Player.zip", "r") as z:
    for name in ["assets/reply_en.lottie", "assets/top.lottie"]:
        d = z.read(name)
        with zipfile.ZipFile(io.BytesIO(d)) as lz:
            anim = json.loads(lz.read("animations/main.json"))
            print(f"=== {name} ===")
            print(f"Name: {anim.get('nm')}, Size: {anim.get('w')}x{anim.get('h')}, FPS: {anim.get('fr')}")
            for l in anim.get("layers", []):
                print(f"  Layer: nm='{l.get('nm')}', type={l.get('ty')}")
