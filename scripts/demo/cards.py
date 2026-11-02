"""Render simple typography cards without depending on FFmpeg's optional drawtext."""
import json
import os
from pathlib import Path
import sys
from PIL import Image, ImageDraw, ImageFont

manifest = json.loads(Path(sys.argv[1]).read_text())
folder = Path(sys.argv[2])
font = os.environ.get("DEMO_FONT", "/System/Library/Fonts/Supplemental/Arial.ttf")
for name, lines in manifest["cards"].items():
    image = Image.new("RGB", (1920, 1080), "#111b23")
    draw = ImageDraw.Draw(image)
    draw.rectangle((160, 235, 255, 243), fill="#e4aa73")
    for index, line in enumerate(lines):
        draw.text((160, 310 + index * 115), line, font=ImageFont.truetype(font, 62 if index == 0 else 34), fill="#f7f2e8" if index == 0 else "#b1c1cc")
    image.save(folder / f"{name}.png")
