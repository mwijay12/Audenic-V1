import zipfile, struct

with zipfile.ZipFile("Lark_Player.zip", "r") as z:
    arsc_bytes = z.read("resources.arsc")

sp_offset = 0xc
chunk_type, chunk_hdr, chunk_size = struct.unpack_from("<HHI", arsc_bytes, sp_offset)
string_count, style_count, flags, strings_start, styles_start = struct.unpack_from("<IIIII", arsc_bytes, sp_offset + 8)

def decode_utf8(data, off):
    b = data[off]; off += 1
    if b & 0x80: off += 1
    b = data[off]; off += 1
    if b & 0x80: u8len = ((b & 0x7f) << 8) | data[off]; off += 1
    else: u8len = b
    return data[off : off + u8len].decode("utf-8", errors="ignore")

for i in range(string_count):
    str_off = struct.unpack_from("<I", arsc_bytes, sp_offset + chunk_hdr + i * 4)[0]
    s = decode_utf8(arsc_bytes, sp_offset + strings_start + str_off)
    if "Lark" in s or "lark" in s:
        print(f"String {i}: {repr(s)}")
