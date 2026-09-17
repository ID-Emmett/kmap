"""汇总实际浏览器帧数据，导出静态图与冷加载联系表。"""
import base64
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from PIL import Image, ImageDraw

output = Path(__file__).resolve().parent
root = output.parents[2]
reports = []
for argument in sys.argv[1:]:
    path = Path(argument)
    data = json.loads(path.read_text(encoding='utf-8'))
    backend = data['backend']
    scenes = data['images']
    sheet = Image.new('RGB', (1280, ((len(scenes) + 3) // 4) * 195), 'white')
    draw = ImageDraw.Draw(sheet)
    for index, item in enumerate(scenes):
        target = output / f'{backend}-{item["name"]}.png'
        target.write_bytes(base64.b64decode(item['image'].split(',')[1]))
        image = Image.open(target)
        image.thumbnail((320, 170))
        x, y = index % 4 * 320, index // 4 * 195
        sheet.paste(image, (x, y + 20))
        draw.text((x + 4, y + 3), item['name'], fill='black')
    sheet.save(output / f'{backend}-contact.png')
    cold = data['cold']
    sampled = sorted(set(round(i * (len(cold) - 1) / 47) for i in range(48)))
    sheet = Image.new('RGB', (1440, 8 * 150), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, index in enumerate(sampled):
        from io import BytesIO
        image = Image.open(BytesIO(base64.b64decode(cold[index]['image'].split(',')[1])))
        x, y = i % 6 * 240, i // 6 * 150
        sheet.paste(image, (x, y + 20))
        draw.text((x + 3, y + 3), f'frame {index}', fill='black')
    sheet.save(output / f'{backend}-cold.png')
    reports.append({
        'backend': backend, 'raw': argument, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        'viewport': data['viewport'], 'staticScenes': len(scenes),
        'unsettled': [r['name'] for r in data['results'] if r.get('settled') is False],
        'measurements': [{k: v for k, v in r.items() if k != 'samples'} for r in data['results'] if 'settled' not in r],
        'errors': data['errors'],
    })
sources = [*root.glob('packages/map3d/src/**/*.ts'), *root.glob('apps/playground/src/**/*.ts')]
previous_path = output / 'verification-summary.json'
previous = json.loads(previous_path.read_text(encoding='utf-8')) if previous_path.exists() else {}
source_hashes = {str(p.relative_to(root)).replace('\\', '/'): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}
same_runs = [r['sha256'] for r in previous.get('browser', [])] == [r['sha256'] for r in reports]
browser_hashes = previous.get('browserSourceSha256', previous.get('sourceSha256', source_hashes)) if same_runs else source_hashes
summary = {'at': data['at'], 'url': 'http://127.0.0.1:6661/', 'tests': {'sdk': 144, 'playground': 16},
           'browser': reports, 'browserSourceSha256': browser_hashes,
           'sourceSnapshotAtUtc': datetime.now(timezone.utc).isoformat(), 'sourceSha256': source_hashes}
if same_runs:
    for key in ['inspectorUI', 'checks']:
        if key in previous:
            summary[key] = previous[key]
(output / 'verification-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(reports, ensure_ascii=False))
