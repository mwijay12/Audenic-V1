import os
from PIL import Image, ImageDraw

densities = {
    'mipmap-mdpi': 48,
    'mipmap-hdpi': 72,
    'mipmap-xhdpi': 96,
    'mipmap-xxhdpi': 144,
    'mipmap-xxxhdpi': 192,
}

base_res = r'work\decoded\res'

def draw_audenic_icon(size, is_round=False):
    # Render at 4x resolution for super crisp anti-aliasing
    scale = 4
    canvas_size = size * scale
    img = Image.new('RGBA', (canvas_size, canvas_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    pad = 4 * scale
    rect = [pad, pad, canvas_size - pad, canvas_size - pad]

    # Background
    bg_color = (11, 14, 23, 255) # Deep sleek tech dark #0B0E17
    border_color = (37, 150, 255, 180) # Cyan/blue border glow

    if is_round:
        draw.ellipse(rect, fill=bg_color, outline=border_color, width=3 * scale)
    else:
        corner_r = 18 * scale
        draw.rounded_rectangle(rect, radius=corner_r, fill=bg_color, outline=border_color, width=3 * scale)

    # Stylized Audenic "A"
    cx = canvas_size / 2
    top_y = canvas_size * 0.22
    bot_y = canvas_size * 0.78
    half_w = canvas_size * 0.28
    thick = canvas_size * 0.085

    # Left leg: (cx, top_y) to (cx - half_w, bot_y)
    draw.line([(cx, top_y), (cx - half_w, bot_y)], fill=(37, 150, 255, 255), width=int(thick))
    # Right leg: (cx, top_y) to (cx + half_w, bot_y)
    draw.line([(cx, top_y), (cx + half_w, bot_y)], fill=(77, 238, 200, 255), width=int(thick))

    # Soundwave Crossbar (equalizer pulse bars)
    mid_y = canvas_size * 0.58
    bar_h_half = canvas_size * 0.03
    draw.line([(cx - half_w * 0.65, mid_y), (cx + half_w * 0.65, mid_y)], fill=(255, 255, 255, 255), width=int(thick * 0.7))

    # Center sound pulse dot
    dot_r = canvas_size * 0.05
    draw.ellipse([cx - dot_r, mid_y - dot_r, cx + dot_r, mid_y + dot_r], fill=(77, 238, 200, 255))

    # Downsample with Lanczos for anti-aliasing
    final_img = img.resize((size, size), Image.Resampling.LANCZOS)
    return final_img

for folder, size in densities.items():
    target_dir = os.path.join(base_res, folder)
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)

    # Square icon
    sq = draw_audenic_icon(size, is_round=False)
    sq.save(os.path.join(target_dir, 'ic_launcher.webp'), 'WEBP', quality=100)
    
    # Round icon
    rd = draw_audenic_icon(size, is_round=True)
    rd.save(os.path.join(target_dir, 'ic_launcher_round.webp'), 'WEBP', quality=100)
    
    print(f"Generated {size}x{size} icons for {folder}")

print("All Audenic launcher WebP icons generated successfully!")
