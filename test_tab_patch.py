import struct

with open(r'C:\Users\Administrator\Desktop\LARK\resources.arsc', 'rb') as f:
    data = f.read()

sp_offset = 0xc
string_count, style_count, flags, strings_start, styles_start = struct.unpack_from('<IIIII', data, sp_offset + 8)

def decode_utf8(d, off):
    b = d[off]; off += 1
    if b & 0x80: off += 1
    b = d[off]; off += 1
    if b & 0x80: u8len = ((b & 0x7f) << 8) | d[off]; off += 1
    else: u8len = b
    return d[off : off + u8len].decode('utf-8', errors='ignore')

exact_matches = {
    'Videos': 'Reels',
    'Songs': 'Tracks',
    'Playlists': 'Explore',
    'Folders': 'Home',
    'Artists': 'Studio'
}

found = 0
for i in range(string_count):
    str_off = struct.unpack_from('<I', data, sp_offset + 28 + i * 4)[0]
    next_off = struct.unpack_from('<I', data, sp_offset + 28 + (i + 1) * 4)[0]
    s = decode_utf8(data, sp_offset + strings_start + str_off)
    if s in exact_matches:
        max_l = next_off - str_off
        target = exact_matches[s]
        needed = len(target.encode('utf-8')) + 3
        fits = needed <= max_l
        print(f'Idx {i}: "{s}" -> "{target}" (max_len: {max_l}, needed: {needed}, fits: {fits})')
        found += 1

print(f'Total tab strings found: {found}')
