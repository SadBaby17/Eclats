"""Regenerate bundled PWA icons (optional: python3 with Pillow)."""
from PIL import Image, ImageDraw
from pathlib import Path
for size in (192, 512):
    scale = size / 512
    image = Image.new('RGB', (size, size), '#f8f5ef')
    draw = ImageDraw.Draw(image)
    def line(points): draw.line([(round(x*scale), round(y*scale)) for x,y in points], fill='#92713e', width=max(1,round(18*scale)))
    line([(170,150),(170,365)])
    for y,end in ((150,350),(256,315),(365,350)): line([(161,y),(end,y)])
    draw.polygon([(round(x*scale),round(y*scale)) for x,y in [(315,85),(329,55),(343,85),(329,115)]],fill='#92713e')
    image.save(Path(__file__).resolve().parent.parent / f'public/icons/icon-{size}.png')
