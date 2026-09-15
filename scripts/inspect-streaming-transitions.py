"""从浏览器原始录像按 60Hz 生成指定瞬时过渡的连续审查图。"""
import argparse
import json
import subprocess
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw

parser = argparse.ArgumentParser()
parser.add_argument('report', type=Path)
parser.add_argument('start', type=float)
parser.add_argument('--duration', type=float, default=1)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
report = json.loads(args.report.read_text(encoding='utf-8'))
output = args.report.parent / (args.report.stem + '-video-review') / f'dense-{args.start:.3f}'
output.mkdir(parents=True, exist_ok=True)
subprocess.run([
    imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error',
    '-ss', str(args.start), '-i', str(root / report['video']), '-t', str(args.duration),
    '-vf', 'fps=60,scale=960:-2', '-q:v', '2', str(output / '%05d.jpg'),
], check=True)
frames = sorted(output.glob('[0-9][0-9][0-9][0-9][0-9].jpg'))
width = 240
with Image.open(frames[0]) as first:
    height = round(first.height * width / first.width)
for page in range((len(frames) + 29) // 30):
    sheet = Image.new('RGB', (5 * width, 6 * (height + 22)), '#202630')
    draw = ImageDraw.Draw(sheet)
    for cell, file in enumerate(frames[page * 30:(page + 1) * 30]):
        x, y = cell % 5 * width, cell // 5 * (height + 22)
        with Image.open(file) as frame:
            sheet.paste(frame.resize((width, height)), (x, y))
        draw.text((x + 3, y + height + 2), f'{args.start + (page * 30 + cell) / 60:.3f}s', fill='white')
    sheet.save(output / f'continuous-{page:02d}.jpg', quality=92)
summary = {'report': args.report.name, 'video': report['video'], 'startSeconds': args.start,
           'durationSeconds': args.duration, 'samplingHz': 60, 'frameCount': len(frames),
           'method': '60Hz resampling of captured WebM; duplicate source frames may occur'}
(output / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary))
