"""Generate a pure-vector musical Lottie animation for the Audenic header.

Uses only crisp geometric vector paths and shape layers (zero raster PNGs),
following the motion-lab vector craft rules: clean flat palette, uniform
rounded strokes, four-point sparkle accent, and a seamless 3.0 s musical
equalizer + note loop at 194x56.

Usage:
    python3 generate_audenic_lottie.py [output_path]
"""

import json
import math
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_OUT = os.path.join(HERE, "test_audenic.lottie")


def _hex_rgba(hex_str, alpha=1.0):
    h = hex_str.lstrip("#")
    return [
        round(int(h[0:2], 16) / 255.0, 4),
        round(int(h[2:4], 16) / 255.0, 4),
        round(int(h[4:6], 16) / 255.0, 4),
        alpha,
    ]


def _path_shape(vertices, closed=True):
    return {
        "c": closed,
        "i": [[0, 0]] * len(vertices),
        "o": [[0, 0]] * len(vertices),
        "v": vertices,
    }


def _bezier_shape(vertices, in_t, out_t, closed=True):
    return {"c": closed, "i": in_t, "o": out_t, "v": vertices}


def _static_tr(pos=(0, 0), anchor=(0, 0), scale=(100, 100), rot=0, opacity=100):
    return {
        "o": {"a": 0, "k": opacity},
        "r": {"a": 0, "k": rot},
        "p": {"a": 0, "k": [pos[0], pos[1], 0]},
        "a": {"a": 0, "k": [anchor[0], anchor[1], 0]},
        "s": {"a": 0, "k": [scale[0], scale[1], 100]},
    }


def _ease_keyframes(times_vals, dim=1):
    """Build smooth Lottie easing keyframes that loop cleanly."""
    kfs = []
    for idx, (t, val) in enumerate(times_vals):
        v_list = list(val) if isinstance(val, (list, tuple)) else [val]
        if idx == len(times_vals) - 1:
            kfs.append({"t": t, "s": v_list})
        else:
            ease = [0.42] * dim
            ease_out = [0.58] * dim
            kfs.append({
                "t": t,
                "s": v_list,
                "i": {"x": ease, "y": [1.0] * dim},
                "o": {"x": ease_out, "y": [0.0] * dim},
            })
    return kfs


def _make_eq_bar_layer(ind, name, x_center, phase, color_hex, min_h=6, max_h=22, total_frames=90):
    """Equalizer bar that breathes smoothly in musical harmony over a 90-frame loop."""
    y_bottom = 39.0
    width = 3.4
    # Sample 7 smooth keyframes around a full 2*pi cycle (0, 15, 30, 45, 60, 75, 90)
    kfs_size = []
    kfs_pos = []
    steps = [0, 15, 30, 45, 60, 75, 90]
    for t in steps:
        ang = (2.0 * math.pi * t / total_frames) + phase
        # Double-harmonic musical bounce
        norm = 0.5 + 0.35 * math.sin(ang) + 0.15 * math.cos(2.0 * ang)
        norm = max(0.0, min(1.0, norm))
        h = round(min_h + (max_h - min_h) * norm, 2)
        cy = round(y_bottom - h / 2.0, 2)
        kfs_size.append((t, [width, h]))
        kfs_pos.append((t, [0, cy]))

    return {
        "ddd": 0,
        "ind": ind,
        "ty": 4,
        "nm": name,
        "sr": 1,
        "ks": {
            "o": {"a": 0, "k": 100},
            "r": {"a": 0, "k": 0},
            "p": {"a": 0, "k": [x_center, 0, 0]},
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": {"a": 0, "k": [100, 100, 100]},
        },
        "ao": 0,
        "shapes": [
            {
                "ty": "gr",
                "nm": "bar",
                "it": [
                    {
                        "ty": "rc",
                        "d": 1,
                        "s": {"a": 1, "k": _ease_keyframes(kfs_size, dim=2)},
                        "p": {"a": 1, "k": _ease_keyframes(kfs_pos, dim=2)},
                        "r": {"a": 0, "k": 1.7},
                        "nm": "rect",
                    },
                    {
                        "ty": "fl",
                        "c": {"a": 0, "k": _hex_rgba(color_hex)},
                        "o": {"a": 0, "k": 100},
                        "r": 1,
                        "nm": "fill",
                    },
                    {"ty": "tr", **_static_tr()},
                ],
            }
        ],
        "ip": 0,
        "op": total_frames,
        "st": 0,
        "bm": 0,
    }


def _wordmark_stroke_items():
    """Crisp pure-vector 'AUDENIC' wordmark strokes (x=54..157, y=21..35)."""
    # Uniform geometric 2.3px rounded strokes in pure crisp white
    letters = [
        # A
        ([[54, 34], [59.5, 21], [65, 34]], False),
        ([[56.2, 29.8], [62.8, 29.8]], False),
        # U
        ([[70, 21], [70, 30.5], [72.5, 34], [77.5, 34], [80, 30.5], [80, 21]], False),
        # D
        ([[86, 21], [86, 34], [91.5, 34], [95.2, 31], [95.2, 24], [91.5, 21], [86, 21]], True),
        # E
        ([[108.5, 21], [100.5, 21], [100.5, 34], [108.5, 34]], False),
        ([[100.5, 27.5], [107, 27.5]], False),
        # N
        ([[113.5, 34], [113.5, 21], [123, 34], [123, 21]], False),
        # I
        ([[129.5, 21], [129.5, 34]], False),
        # C
        ([[145.5, 23.2], [142.8, 21], [138.2, 21], [135.5, 24], [135.5, 31], [138.2, 34], [142.8, 34], [145.5, 31.8]], False),
    ]
    items = []
    for idx, (pts, closed) in enumerate(letters):
        items.append({
            "ty": "sh",
            "d": 1,
            "ks": {"a": 0, "k": _path_shape(pts, closed=closed)},
            "nm": f"letter_{idx}",
        })
    items.append({
        "ty": "st",
        "c": {"a": 0, "k": _hex_rgba("#F8FAFC")},
        "o": {"a": 0, "k": 100},
        "w": {"a": 0, "k": 2.3},
        "lc": 2,
        "lj": 2,
        "ml": 4,
        "nm": "wordmark_stroke",
    })
    items.append({"ty": "tr", **_static_tr()})
    return items


def build_lottie_json():
    total_frames = 90
    layers = []

    # 1. Background pill badge for the musical equalizer emblem (left side, x=6..45, y=10..46)
    layers.append({
        "ddd": 0,
        "ind": 1,
        "ty": 4,
        "nm": "emblem_badge",
        "sr": 1,
        "ks": {
            "o": {"a": 0, "k": 100},
            "r": {"a": 0, "k": 0},
            "p": {"a": 0, "k": [25.5, 28, 0]},
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": {
                "a": 1,
                "k": _ease_keyframes(
                    [(0, [100, 100]), (45, [103, 103]), (90, [100, 100])],
                    dim=2,
                ),
            },
        },
        "ao": 0,
        "shapes": [
            {
                "ty": "gr",
                "nm": "pill",
                "it": [
                    {
                        "ty": "rc",
                        "d": 1,
                        "s": {"a": 0, "k": [36, 32]},
                        "p": {"a": 0, "k": [0, 0]},
                        "r": {"a": 0, "k": 10},
                        "nm": "bg",
                    },
                    {
                        "ty": "fl",
                        "c": {"a": 0, "k": _hex_rgba("#0B1233")},
                        "o": {"a": 0, "k": 94},
                        "r": 1,
                        "nm": "bg_fill",
                    },
                    {
                        "ty": "st",
                        "c": {"a": 0, "k": _hex_rgba("#4DEEC8")},
                        "o": {"a": 0, "k": 85},
                        "w": {"a": 0, "k": 1.6},
                        "lc": 2,
                        "lj": 2,
                        "nm": "bg_stroke",
                    },
                    {"ty": "tr", **_static_tr()},
                ],
            }
        ],
        "ip": 0,
        "op": total_frames,
        "st": 0,
        "bm": 0,
    })

    # 2. Five animated musical equalizer bars inside the badge
    bar_specs = [
        (2, "eq_1", 14.5, 0.0, "#2596FF", 7, 18),
        (3, "eq_2", 20.0, 1.2, "#4DEEC8", 9, 23),
        (4, "eq_3", 25.5, 2.3, "#F8FAFC", 10, 24),
        (5, "eq_4", 31.0, 3.5, "#4DEEC8", 8, 22),
        (6, "eq_5", 36.5, 4.7, "#2596FF", 6, 17),
    ]
    for ind, nm, x_c, ph, col, minh, maxh in bar_specs:
        layers.append(_make_eq_bar_layer(ind, nm, x_c, ph, col, minh, maxh, total_frames))

    # 3. Pure vector 'AUDENIC' wordmark
    layers.append({
        "ddd": 0,
        "ind": 7,
        "ty": 4,
        "nm": "wordmark",
        "sr": 1,
        "ks": _static_tr(),
        "ao": 0,
        "shapes": [{"ty": "gr", "nm": "letters", "it": _wordmark_stroke_items()}],
        "ip": 0,
        "op": total_frames,
        "st": 0,
        "bm": 0,
    })

    # 4. Signature four-point musical sparkle (gold #F4D774) on the right
    spark_r = 7.5
    spark_in = 2.1
    spark_pts = [
        [0, -spark_r],
        [spark_in, -spark_in],
        [spark_r, 0],
        [spark_in, spark_in],
        [0, spark_r],
        [-spark_in, spark_in],
        [-spark_r, 0],
        [-spark_in, -spark_in],
    ]
    layers.append({
        "ddd": 0,
        "ind": 8,
        "ty": 4,
        "nm": "musical_sparkle",
        "sr": 1,
        "ks": {
            "o": {"a": 1, "k": _ease_keyframes([(0, 82), (45, 100), (90, 82)], dim=1)},
            "r": {"a": 1, "k": _ease_keyframes([(0, -6), (45, 6), (90, -6)], dim=1)},
            "p": {"a": 0, "k": [163, 27.5, 0]},
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": {"a": 1, "k": _ease_keyframes([(0, [92, 92]), (45, [112, 112]), (90, [92, 92])], dim=2)},
        },
        "ao": 0,
        "shapes": [
            {
                "ty": "gr",
                "nm": "sparkle",
                "it": [
                    {"ty": "sh", "d": 1, "ks": {"a": 0, "k": _path_shape(spark_pts, closed=True)}, "nm": "star"},
                    {"ty": "fl", "c": {"a": 0, "k": _hex_rgba("#F4D774")}, "o": {"a": 0, "k": 100}, "r": 1, "nm": "fill"},
                    {"ty": "tr", **_static_tr()},
                ],
            }
        ],
        "ip": 0,
        "op": total_frames,
        "st": 0,
        "bm": 0,
    })

    # 5. Subtle floating eighth-note accent on far right (x=179, y=27)
    layers.append({
        "ddd": 0,
        "ind": 9,
        "ty": 4,
        "nm": "floating_note",
        "sr": 1,
        "ks": {
            "o": {"a": 0, "k": 95},
            "r": {"a": 1, "k": _ease_keyframes([(0, -3), (45, 3), (90, -3)], dim=1)},
            "p": {"a": 1, "k": _ease_keyframes([(0, [179, 28]), (45, [179, 25.5]), (90, [179, 28])], dim=2)},
            "a": {"a": 0, "k": [0, 0, 0]},
            "s": {"a": 0, "k": [100, 100, 100]},
        },
        "ao": 0,
        "shapes": [
            {
                "ty": "gr",
                "nm": "note",
                "it": [
                    {
                        "ty": "el",
                        "d": 1,
                        "s": {"a": 0, "k": [6.5, 5.0]},
                        "p": {"a": 0, "k": [-2.2, 4.5]},
                        "nm": "notehead",
                    },
                    {
                        "ty": "fl",
                        "c": {"a": 0, "k": _hex_rgba("#4DEEC8")},
                        "o": {"a": 0, "k": 100},
                        "r": 1,
                        "nm": "head_fill",
                    },
                    {
                        "ty": "sh",
                        "d": 1,
                        "ks": {"a": 0, "k": _path_shape([[0.6, 4.2], [0.6, -6.5], [5.8, -4.2]], closed=False)},
                        "nm": "stem_flag",
                    },
                    {
                        "ty": "st",
                        "c": {"a": 0, "k": _hex_rgba("#4DEEC8")},
                        "o": {"a": 0, "k": 100},
                        "w": {"a": 0, "k": 2.0},
                        "lc": 2,
                        "lj": 2,
                        "nm": "stem_stroke",
                    },
                    {"ty": "tr", **_static_tr()},
                ],
            }
        ],
        "ip": 0,
        "op": total_frames,
        "st": 0,
        "bm": 0,
    })

    return {
        "v": "5.9.0",
        "fr": 30,
        "ip": 0,
        "op": total_frames,
        "w": 194,
        "h": 56,
        "nm": "audenic_musical_header",
        "ddd": 0,
        "assets": [],
        "layers": layers,
    }


def generate_lottie(output_path=DEFAULT_OUT):
    manifest = {
        "version": "1.0.0",
        "author": "Audenic",
        "generator": "generate_audenic_lottie.py",
        "animations": [{"id": "main"}],
    }
    anim = build_lottie_json()
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("manifest.json", json.dumps(manifest, separators=(",", ":")))
        zf.writestr("animations/main.json", json.dumps(anim, separators=(",", ":")))
    print(f"Created pure-vector musical Lottie: {output_path} ({os.path.getsize(output_path)} bytes)")
    return output_path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_OUT
    generate_lottie(out)
