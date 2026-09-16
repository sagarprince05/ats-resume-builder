"""
Generates the app icon (PNG for the web manifest, ICO for the Windows exe)
using only the Python standard library. Run from the project root:

    python desktop/make_icons.py
"""
import os
import struct
import sys
import zlib

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BG_TOP = (0x2F, 0x80, 0xED)
BG_BOTTOM = (0x1F, 0x3A, 0x5F)
WHITE = (255, 255, 255)


def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def render(size):
    """Rounded square with a diagonal gradient and three 'text' lines."""
    px = bytearray()
    r = size * 0.22
    lines = [  # (x0, x1, y_center, thickness, alpha) as fractions of size
        (0.24, 0.76, 0.34, 0.085, 1.0),
        (0.24, 0.64, 0.52, 0.085, 0.85),
        (0.24, 0.52, 0.70, 0.085, 0.65),
    ]
    for y in range(size):
        for x in range(size):
            # rounded-rect coverage with 2x2 supersampling for smooth corners
            cov = 0
            for sy in (0.25, 0.75):
                for sx in (0.25, 0.75):
                    fx, fy = x + sx, y + sy
                    cx = min(max(fx, r), size - r)
                    cy = min(max(fy, r), size - r)
                    if (fx - cx) ** 2 + (fy - cy) ** 2 <= r * r:
                        cov += 1
            a = cov / 4
            if a == 0:
                px += bytes((0, 0, 0, 0))
                continue
            t = (x + y) / (2 * size)
            col = lerp(BG_TOP, BG_BOTTOM, t)
            fx, fy = x / size, y / size
            for (x0, x1, yc, th, la) in lines:
                if x0 <= fx <= x1 and abs(fy - yc) <= th / 2:
                    # soften ends
                    edge = min(fx - x0, x1 - fx) / (th / 2)
                    la2 = la * min(1.0, edge)
                    col = lerp(col, WHITE, la2)
            px += bytes((col[0], col[1], col[2], int(255 * a)))
    return bytes(px)


def png_bytes(size, rgba):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + rgba[y * size * 4:(y + 1) * size * 4] for y in range(size))
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def ico_bytes(images):
    """images: list of (size, png_bytes). PNG-compressed ICO entries (Vista+)."""
    header = struct.pack("<HHH", 0, 1, len(images))
    entries = b""
    data = b""
    offset = 6 + 16 * len(images)
    for size, png in images:
        s = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", s, s, 0, 0, 1, 32, len(png), offset)
        data += png
        offset += len(png)
    return header + entries + data


def main():
    icons_dir = os.path.join(ROOT, "icons")
    os.makedirs(icons_dir, exist_ok=True)
    pngs = {}
    for size in (16, 32, 48, 64, 128, 192, 256, 512):
        print(f"rendering {size}px", flush=True)
        pngs[size] = png_bytes(size, render(size))
    for size in (192, 512):
        with open(os.path.join(icons_dir, f"icon-{size}.png"), "wb") as f:
            f.write(pngs[size])
    with open(os.path.join(ROOT, "desktop", "icon.ico"), "wb") as f:
        f.write(ico_bytes([(s, pngs[s]) for s in (16, 32, 48, 64, 128, 256)]))
    print("wrote icons/icon-192.png, icons/icon-512.png, desktop/icon.ico")


if __name__ == "__main__":
    sys.exit(main())
