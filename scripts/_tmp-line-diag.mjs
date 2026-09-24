/** 临时分析：线的渲染状态诊断——完全不可见时的具体原因。 */
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const frames = j.frames ?? [];
const max = key => Math.max(0, ...frames.map(f => f[key] ?? 0));
console.log('frames', frames.length, '| hiddenLines', max('hiddenLines'), '| stencilMismatch', max('stencilMismatch'),
  '| uninitLines', max('uninitLines'), '| missingLines', max('missingLines'), '| zeroSegments', max('zeroSegments'));
const bad = frames.filter(f => (f.hiddenLines ?? 0) > 0 || (f.stencilMismatch ?? 0) > 0 || (f.uninitLines ?? 0) > 0);
console.log('异常帧数', bad.length, '/', frames.length);
for (const f of bad.slice(0, 8)) {
  console.log(JSON.stringify({ at: f.at, levels: f.levels, hidden: f.hiddenLines, mismatch: f.stencilMismatch, uninit: f.uninitLines,
    lines: f.lines, ink: f.ink, samples: f.lineSamples }));
}
