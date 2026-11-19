#!/usr/bin/env python3
"""Membuat seluruh ikon PNG Alinkvault dari sketsa vektor sederhana (PIL).

Jalankan dari akar repo:  python3 tools/gen_icons.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent

SS = 4  # supersampling
BASE = 512


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def gradient(size: int, c0: tuple[int, int, int], c1: tuple[int, int, int]) -> Image.Image:
    img = Image.new("RGB", (size, size))
    px = img.load()
    for y in range(size):
        for x in range(size):
            t = (x / max(1, size - 1) + y / max(1, size - 1)) / 2
            px[x, y] = tuple(int(lerp(c0[i], c1[i], t)) for i in range(3))
    return img


def radial_glow(size: int, center: tuple[float, float], radius: float, color: tuple[int, int, int], alpha: int) -> Image.Image:
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    steps = 26
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        a = int(alpha * (1 - t) ** 2)
        draw.ellipse(
            [center[0] - r, center[1] - r, center[0] + r, center[1] + r],
            fill=(*color, a),
        )
    return layer.filter(ImageFilter.GaussianBlur(radius * 0.06))


def star(draw: ImageDraw.ImageDraw, cx: float, cy: float, r: float, color: tuple[int, int, int, int]) -> None:
    pts = []
    for i in range(8):
        angle = math.pi / 4 * i - math.pi / 2
        rad = r if i % 2 == 0 else r * 0.24
        pts.append((cx + math.cos(angle) * rad, cy + math.sin(angle) * rad))
    draw.polygon(pts, fill=color)


def make_base(maskable: bool = False) -> Image.Image:
    S = BASE * SS
    scale = S / 512

    bg = gradient(512, (42, 28, 104), (7, 10, 22)).resize((S, S), Image.BICUBIC)
    canvas = bg.convert("RGBA")

    glow = Image.new("RGBA", (512, 512), (0, 0, 0, 0))
    glow.alpha_composite(radial_glow(512, (140, 110), 300, (139, 123, 255), 210))
    glow.alpha_composite(radial_glow(512, (430, 470), 260, (69, 224, 230), 120))
    canvas.alpha_composite(glow.resize((S, S), Image.BICUBIC))

    inset = 0 if maskable else 58 * scale
    content = 1.0
    if maskable:
        inset = 40 * scale
        content = 0.92

    # Bingkai kaca
    frame = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fd = ImageDraw.Draw(frame)
    r = 104 * scale * content
    fd.rounded_rectangle(
        [inset, inset, S - inset, S - inset],
        radius=r,
        fill=(255, 255, 255, 16),
        outline=(255, 255, 255, 40),
        width=max(2, int(2.5 * scale * content)),
    )
    # Kilau diagonal di kaca
    sheen = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sd = ImageDraw.Draw(sheen)
    sd.polygon(
        [(inset, inset + 250 * scale), (inset + 250 * scale, inset), (S - inset, inset), (inset, S - inset)],
        fill=(255, 255, 255, 9),
    )
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([inset, inset, S - inset, S - inset], radius=r, fill=255)
    frame.alpha_composite(Image.composite(sheen, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
    canvas.alpha_composite(frame)

    # Rantai: dua mata rantai kapsul yang bertaut
    def capsule(layer: Image.Image, color: tuple[int, int, int, int], cx: float, cy: float, rot: float) -> Image.Image:
        l = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        ld = ImageDraw.Draw(l)
        w, h = 155 * scale * content, 72.5 * scale * content
        ld.rounded_rectangle(
            [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
            radius=h / 2,
            outline=color,
            width=int(23 * scale * content),
        )
        return l.rotate(rot, center=(cx, cy), resample=Image.BICUBIC)

    # Cahaya lembut di belakang rantai
    glow_layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow_layer)
    for cx, cy, color in (
        (240 * scale, 262 * scale, (180, 235, 255, 110)),
        (271 * scale, 251 * scale, (150, 130, 255, 110)),
    ):
        w, h = 155 * scale * content, 72.5 * scale * content
        gd.rounded_rectangle(
            [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
            radius=h / 2,
            outline=color,
            width=int(23 * scale * content),
        )
    glow_layer = glow_layer.rotate(-37, center=(255 * scale, 257 * scale), resample=Image.BICUBIC)
    glow_layer = glow_layer.filter(ImageFilter.GaussianBlur(9 * scale))
    canvas.alpha_composite(glow_layer)

    canvas.alpha_composite(capsule(canvas, (236, 252, 255, 255), 240 * scale, 262 * scale, -37))
    canvas.alpha_composite(capsule(canvas, (158, 146, 255, 255), 271 * scale, 251 * scale, -37))

    # Percikan
    spark = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sdd = ImageDraw.Draw(spark)
    star(sdd, 392 * scale, 128 * scale, 20 * scale * content, (255, 255, 255, 230))
    star(sdd, 126 * scale, 352 * scale, 13 * scale * content, (255, 255, 255, 160))
    canvas.alpha_composite(spark)

    # Sudut membulat untuk ikon non-maskable
    if not maskable:
        round_mask = Image.new("L", (S, S), 0)
        ImageDraw.Draw(round_mask).rounded_rectangle([0, 0, S, S], radius=120 * scale, fill=255)
        canvas.putalpha(round_mask)

    return canvas


def main() -> None:
    base = make_base(False)
    maskable = make_base(True)

    targets = [
        ("icon-180.png", 180, base),
        ("icon-192.png", 192, base),
        ("icon-512.png", 512, base),
        ("icon-maskable-192.png", 192, maskable),
        ("icon-maskable-512.png", 512, maskable),
    ]
    for name, size, source in targets:
        source.resize((size, size), Image.LANCZOS).save(ROOT / name)
        print("dibuat", name)

    android_sizes = {
        "mipmap-mdpi": 48,
        "mipmap-hdpi": 72,
        "mipmap-xhdpi": 96,
        "mipmap-xxhdpi": 144,
        "mipmap-xxxhdpi": 192,
    }
    res = ROOT / "android" / "app" / "src" / "main" / "res"
    for folder, size in android_sizes.items():
        out = res / folder / "ic_launcher.png"
        base.resize((size, size), Image.LANCZOS).save(out)
        print("dibuat", out.relative_to(ROOT))


if __name__ == "__main__":
    main()
