"""从实际浏览器录像生成连续帧审查图与时间索引。"""
import json
import subprocess
import sys
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw

directory = Path(__file__).resolve().parents[1] / 'docs/evidence/streaming-rebuild'
report_path = Path(sys.argv[1]) if len(sys.argv) > 1 else max(directory.glob('webgpu-*.json'), key=lambda p: p.stat().st_mtime)
report = json.loads(report_path.read_text(encoding='utf-8'))
video = Path(__file__).resolve().parents[1] / report['video']
output = directory / (report_path.stem + '-video-review')
output.mkdir(exist_ok=True)
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error', '-i', str(video), '-vf', 'fps=10,scale=640:-2', '-q:v', '3', str(output / '%05d.jpg')], check=True)
frames = sorted(output.glob('[0-9][0-9][0-9][0-9][0-9].jpg'))
expected_ms = report.get('durationMs', max((f['atMs'] for f in report.get('renderFrames', [])), default=0))
if expected_ms and len(frames) * 100 < expected_ms * .9:
    raise RuntimeError(f'录像时长不足：{len(frames) / 10:.1f}s / 预期 {expected_ms / 1000:.1f}s')
stages = report.get('stages', [])
def stage_at(t):
    matches = [s['name'] for s in stages if s['atMs'] <= t * 1000]
    return matches[-1] if matches else 'initial'

def sheets(selected, name, columns, rows, width):
    first = Image.open(frames[0])
    height = round(first.height * width / first.width)
    per_page = columns * rows
    for page in range((len(selected) + per_page - 1) // per_page):
        sheet = Image.new('RGB', (columns * width, rows * (height + 22)), '#202630')
        draw = ImageDraw.Draw(sheet)
        for cell, (index, file) in enumerate(selected[page * per_page:(page + 1) * per_page]):
            frame = Image.open(file).resize((width, height))
            x, y = cell % columns * width, cell // columns * (height + 22)
            sheet.paste(frame, (x, y))
            draw.text((x + 3, y + height + 2), f'{index / 10:.1f}s {stage_at(index / 10)}', fill='white')
        sheet.save(output / f'{name}-{page:02d}.jpg', quality=90)

sheets(list(enumerate(frames))[::10], 'sheet', 4, 5, 320)
sheets(list(enumerate(frames)), 'continuous', 6, 10, 192)

summary = {'report': report_path.name, 'video': str(video), 'frames10Hz': len(frames), 'sheets': len(list(output.glob('sheet-*.jpg'))), 'frameSummary': report.get('frameSummary'), 'assertions': report.get('assertions')}
(output / 'summary.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary, indent=2))
