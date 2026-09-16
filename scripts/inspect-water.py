import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageChops

directory = Path('docs/evidence/streaming-rebuild')
keys = ['8-215-99', '8-215-100', '6-54-25']
out = Image.new('RGB', (768, 256))
for i, key in enumerate(keys):
    data = json.loads((directory / f'T046-water-{key}.json').read_text(encoding='utf-8'))
    im = Image.new('RGB', (256, 256), '#f5f5f2')
    for feature in data['water']:
        mask = Image.new('1', (256, 256))
        for ring in feature['g']:
            part = Image.new('1', (256, 256))
            ImageDraw.Draw(part).polygon([(p['x']*256/data['extent'], p['y']*256/data['extent']) for p in ring], fill=1)
            mask = ImageChops.logical_xor(mask, part)
        im.paste('#a9d7e8', mask=mask)
    out.paste(im, (i*256, 0))
out.save(directory / 'T046-water-raster.png')
