import zipfile, io, json

with zipfile.ZipFile(r"C:\Users\Administrator\Desktop\LARK\Lark_Player.zip", "r") as z:
    d = z.read("assets/reply_en.lottie")
    with zipfile.ZipFile(io.BytesIO(d)) as lz:
        anim = json.loads(lz.read("animations/main.json"))
        # Print asset 0 and asset 3 details
        for a in anim.get("assets", []):
            if a.get("id") in ["0", "3"]:
                print(f"=== Asset {a.get('id')} ===")
                print(json.dumps(a, indent=2)[:500])
