"""Render Quick Popup Search icons as PNGs with pure Python (no Pillow).

Shapes are signed-distance functions in 0..1 space, supersampled for anti-aliasing.
Usage: python3 make_icons.py <out_dir>
"""
import math
import os
import struct
import sys
import zlib

TOP = (0x4F, 0x8C, 0xFF)     # gradient top
BOTTOM = (0x1E, 0x40, 0xC8)  # gradient bottom
WHITE = (255, 255, 255)


def sd_round_box(x, y, cx, cy, h, r):
    qx = abs(x - cx) - (h - r)
    qy = abs(y - cy) - (h - r)
    out = math.hypot(max(qx, 0), max(qy, 0))
    return out + min(max(qx, qy), 0) - r


def sd_segment(x, y, ax, ay, bx, by, w):
    px, py = x - ax, y - ay
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, (px * dx + py * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - dx * t, py - dy * t) - w / 2


def sd_ring(x, y, cx, cy, radius, w):
    return abs(math.hypot(x - cx, y - cy) - radius) - w / 2


def sd_rect(x, y, x0, y0, x1, y1, r):
    return sd_round_box_xy(x, y, (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2, r)


def sd_round_box_xy(x, y, cx, cy, hx, hy, r):
    qx = abs(x - cx) - (hx - r)
    qy = abs(y - cy) - (hy - r)
    return math.hypot(max(qx, 0), max(qy, 0)) + min(max(qx, qy), 0) - r


def magnifier(x, y, c, radius, stroke):
    """Return (ring+handle distance, lens-disc distance)."""
    d = sd_ring(x, y, c[0], c[1], radius, stroke)
    hx, hy = c[0] + radius * 0.72, c[1] + radius * 0.72
    d = min(d, sd_segment(x, y, hx + 0.02, hy + 0.02, hx + 0.15, hy + 0.15, stroke * 1.35))
    return d, math.hypot(x - c[0], y - c[1]) - radius


def foreground(x, y, size):
    """True where the pixel is white."""
    if size < 48:
        d, _ = magnifier(x, y, (0.44, 0.46), 0.22, 0.12)
        return d <= 0

    white = False
    # floating window card with a title-bar line
    if sd_rect(x, y, 0.16, 0.20, 0.74, 0.66, 0.07) <= 0:
        white = True
        if 0.305 <= y <= 0.345 and 0.16 <= x <= 0.74:
            white = False  # title bar divider
        if math.hypot(x - 0.24, y - 0.262) <= 0.025 or math.hypot(x - 0.315, y - 0.262) <= 0.025:
            white = False  # window dots
    # magnifier overlapping bottom-right, separated by a blue halo
    d, lens = magnifier(x, y, (0.62, 0.60), 0.16, 0.08)
    if d <= 0.045 or lens <= 0:
        white = False
    if d <= 0:
        white = True
    return white


def render(size, ss=6):
    rows = []
    for py in range(size):
        row = bytearray([0])  # PNG filter type 0
        for px in range(size):
            bg_hits = fg_hits = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = (px + (sx + 0.5) / ss) / size
                    y = (py + (sy + 0.5) / ss) / size
                    if sd_round_box(x, y, 0.5, 0.5, 0.47, 0.22) <= 0:
                        bg_hits += 1
                        if foreground(x, y, size):
                            fg_hits += 1
            n = ss * ss
            alpha = bg_hits / n
            fg = fg_hits / bg_hits if bg_hits else 0
            t = (py + 0.5) / size
            base = [TOP[i] + (BOTTOM[i] - TOP[i]) * t for i in range(3)]
            rgb = [round(base[i] + (WHITE[i] - base[i]) * fg) for i in range(3)]
            row += bytes(rgb + [round(alpha * 255)])
        rows.append(bytes(row))
    return b"".join(rows)


def write_png(path, size, raw):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    for s in (16, 32, 48, 128):
        write_png(os.path.join(out, f"icon{s}.png"), s, render(s))
        print("wrote", f"icon{s}.png")
