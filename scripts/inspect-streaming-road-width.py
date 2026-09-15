"""以原始分辨率扫描黄色主干道路的局部厚度，并保存峰值帧供视觉复核。"""
import argparse, json
from pathlib import Path
import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('report', type=Path)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
report = json.loads(args.report.read_text(encoding='utf-8'))
cap = cv2.VideoCapture(str(root / report['video']))
fps = cap.get(cv2.CAP_PROP_FPS)
output = args.report.parent / (args.report.stem + '-video-review')
output.mkdir(exist_ok=True)
frames = []; index = 0; best = -1
cv2.setNumThreads(2)
while True:
    ok, frame = cap.read()
    if not ok: break
    # 10Hz 全程扫描；相邻帧时序由独立的 60Hz 审查覆盖。
    if index % max(1, round(fps / 10)) == 0:
        b, g, r = [a.astype(np.int16) for a in cv2.split(frame)]
        mask = ((r > 175) & (g > 155) & (r - b > 35) & (g - b > 25) & (r - g < 55)).astype(np.uint8)
        distance = cv2.distanceTransform(mask, cv2.DIST_L2, cv2.DIST_MASK_PRECISE)
        radius = float(distance.max())
        frames.append({'atSeconds': index / fps, 'maxYellowInscribedRadiusPixels': radius, 'yellowPixels': int(mask.sum())})
        if radius > best:
            best = radius
            cv2.imwrite(str(output / 'widest-yellow-region.jpg'), frame, [cv2.IMWRITE_JPEG_QUALITY, 95])
    index += 1
cap.release()
result = {'report': args.report.name, 'video': report['video'], 'fps': fps, 'decodedFrames': index,
          'samples': frames, 'peak': max(frames, key=lambda f: f['maxYellowInscribedRadiusPixels']),
          'method': 'Full-resolution yellow-road color mask and Euclidean inscribed radius, 10Hz. Junctions and touching parallel roads contribute; this is a visual-review aid, not an isolated stroke-width measurement.'}
(output / 'road-thickness.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k != 'samples'}, indent=2))
