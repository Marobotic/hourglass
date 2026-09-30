#!/usr/bin/env python3
# Renders the pixel hourglass (same grid as linux/app/Hourglass/Logo.qml).
from PIL import Image, ImageDraw
from pathlib import Path

ROWS = [
    "#########",
    ".#.....#.",
    ".#ooooo#.",
    "..#ooo#..",
    "...#o#...",
    "...#o#...",
    "..#.o.#..",
    ".#.ooo.#.",
    ".#ooooo#.",
    "#########",
]
BG, FRAME, SAND = "#121212", "#B14242", "#F0BE66"
OUT = Path(__file__).parent
W, H = len(ROWS[0]), len(ROWS)

def svg(size=512, cell=36):
    ox, oy = (size - W * cell) // 2, (size - H * cell) // 2
    rects = "".join(
        f'<rect x="{ox + c * cell}" y="{oy + r * cell}" width="{cell}" height="{cell}" fill="{SAND if ch == "o" else FRAME}"/>'
        for r, row in enumerate(ROWS) for c, ch in enumerate(row) if ch != "."
    )
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" width="{size}" height="{size}" '
            f'shape-rendering="crispEdges"><rect width="{size}" height="{size}" rx="{int(size * 0.225)}" fill="{BG}"/>{rects}</svg>\n')

def png(size):
    ss = 4
    im = Image.new("RGBA", (size * ss, size * ss), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=int(size * ss * 0.225), fill=BG)
    im = im.resize((size, size), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    c = max(1, round(size * 36 / 512))
    x0, y0 = (size - W * c) // 2, (size - H * c) // 2
    for r, row in enumerate(ROWS):
        for k, ch in enumerate(row):
            if ch != ".":
                d.rectangle([x0 + k * c, y0 + r * c, x0 + (k + 1) * c - 1, y0 + (r + 1) * c - 1], fill=SAND if ch == "o" else FRAME)
    return im

(OUT / "hourglass.svg").write_text(svg())
for s in (1024, 512, 256, 192, 128, 64, 48):
    png(s).save(OUT / f"icon-{s}.png")
