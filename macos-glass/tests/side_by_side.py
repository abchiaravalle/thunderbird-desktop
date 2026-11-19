#!/usr/bin/env python3
"""side_by_side.py out.png left.png right.png [left_label right_label]"""
import sys
from PIL import Image, ImageDraw, ImageFont

out, a, b = sys.argv[1:4]
la = sys.argv[4] if len(sys.argv) > 4 else "BEFORE (stock Thunderbird)"
lb = sys.argv[5] if len(sys.argv) > 5 else "AFTER (this fork)"
A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
import os
sa = float(os.environ.get("LEFT_SCALE", "1"))
if sa != 1:
    A = A.resize((int(A.width * sa), int(A.height * sa)), Image.LANCZOS)
h = max(A.height, B.height)
pad, top = 24, 56
W = A.width + B.width + pad * 3
canvas = Image.new("RGB", (W, h + top + pad), (236, 236, 240))
canvas.paste(A, (pad, top))
canvas.paste(B, (pad * 2 + A.width, top))
d = ImageDraw.Draw(canvas)
try:
    f = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 26)
except Exception:
    f = ImageFont.load_default()
d.text((pad, 14), la, fill=(60, 60, 67), font=f)
d.text((pad * 2 + A.width, 14), lb, fill=(60, 60, 67), font=f)
canvas.save(out, optimize=True)
print(out, canvas.size)
