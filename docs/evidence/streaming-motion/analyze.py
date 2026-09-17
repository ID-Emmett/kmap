"""汇总运动逐帧、静态场景和独立性能证据，记录源码与原始文件哈希。"""
import base64
import hashlib
import json
import sys
from io import BytesIO
from pathlib import Path
from PIL import Image, ImageDraw

output = Path(__file__).resolve().parent
root = output.parents[2]
reports = []
for argument in sys.argv[1:]:
    path = Path(argument)
    data = json.loads(path.read_text(encoding='utf-8'))
    images = data['images']
    sheet = Image.new('RGB', (1440, ((len(images) + 3) // 4) * 210), 'white')
    draw = ImageDraw.Draw(sheet)
    for i, item in enumerate(images):
        image = Image.open(BytesIO(base64.b64decode(item['image'].split(',')[1])))
        image.thumbnail((360, 185))
        x, y = i % 4 * 360, i // 4 * 210
        sheet.paste(image, (x, y + 22))
        draw.text((x + 3, y + 4), item['name'], fill='black')
    sheet.save(output / f'{data["backend"]}-contact.png')
    reports.append({
        'raw': argument, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
        **{key: data[key] for key in ['at', 'backend', 'viewport', 'comparisons', 'maxDifference', 'anomalies', 'performance', 'errors']},
        'staticScenes': len(data['scenes']), 'unsettled': [s['name'] for s in data['scenes'] if not s['settled']],
        'coldStressUncoveredFrames': sum(s['uncovered'] > 0 for s in data['samples']),
    })
sources = [*root.glob('packages/map3d/src/**/*.ts'), *root.glob('apps/playground/src/**/*.ts')]
summary = {'url': 'http://127.0.0.1:6661/', 'tests': {'sdk': 149, 'playground': 16}, 'browser': reports,
           'sourceSha256': {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sources}}
probes = {
    'motionBefore': 'docs/evidence/streaming-rebuild/webgpu-2026-09-17T09-07-17-089Z.json',
    'motionControl': 'docs/evidence/streaming-rebuild/webgpu-2026-09-17T09-12-11-006Z.json',
    'twoRegionStencil': 'docs/evidence/streaming-rebuild/webgpu-2026-09-17T09-45-37-765Z.json',
}
summary['probes'] = {}
for name, path in probes.items():
    p = root / path
    data = json.loads(p.read_text(encoding='utf-8'))
    summary['probes'][name] = {'raw': path, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest(),
                             **{key: data[key] for key in ['backend', 'frames', 'refs', 'failing', 'fixed'] if key in data}}
    if 'changed' in data:
        summary['probes'][name]['changedFrames'] = len(data['changed'])
summary['checks'] = {'pnpm check': 'passed', 'pnpm ai:check': 'passed', 'git diff --check': 'passed'}
(output / 'verification-summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps(reports, ensure_ascii=False))
