import sys
from PIL import Image
# composite transparent screenshots over a mid-gray "desktop" so shape/transparency is visible
for p in sys.argv[1:]:
    im = Image.open(p).convert('RGBA'); bg = Image.new('RGBA', im.size, (96, 108, 128, 255))
    Image.alpha_composite(bg, im).convert('RGB').save(p.replace('.png', '_c.png'))
