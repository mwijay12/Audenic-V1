import zipfile, io, json

with zipfile.ZipFile(r"C:\Users\Administrator\Desktop\LARK\Lark_Player.zip", "r") as z:
    d = z.read("assets/top.lottie")
    with zipfile.ZipFile(io.BytesIO(d)) as lz:
        main_json = json.loads(lz.read("animations/main.json"))
        for l in main_json.get("layers", []):
            print(f"Layer ind={l.get('ind')}, ty={l.get('ty')}, nm='{l.get('nm')}', refId='{l.get('refId')}'")
        for a in main_json.get("assets", []):
            print(f"Asset id='{a.get('id')}', nm='{a.get('nm')}', layers count={len(a.get('layers', []))}")
