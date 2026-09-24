/** 临时分析：逐格无线段数据的分布——定位"线路完全消失"来自哪个来源瓦片。 */
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const frames = j.frames ?? [];
const withNoLine = frames.filter(f => (f.noLineCount ?? 0) > 0);
console.log('帧数', frames.length, '| 无线段的帧数', withNoLine.length, '| 峰值无线段格数', Math.max(0, ...frames.map(f => f.noLineCount ?? 0)));
const worst = frames.reduce((a, b) => ((b.noLineCount ?? 0) > (a.noLineCount ?? 0) ? b : a), frames[0] ?? {});
console.log('最差帧:', JSON.stringify({ at: worst.at, zoom: worst.zoom, levels: worst.levels, gap: worst.gap,
  missing: worst.missing, patches: worst.patches, noLine: worst.noLineCount, ink: worst.ink }));
console.log('样本:', (worst.noLineCells ?? []).slice(0, 12).join('  '));
// 按来源层级归类：区分"来源是低层级"与"来源没有线数据"。
const bySource = new Map();
for (const f of frames) for (const cell of f.noLineCells ?? []) {
  const src = cell.split('<-')[1] ?? '?';
  const z = src.split('/')[0] ?? '?';
  bySource.set(z, (bySource.get(z) ?? 0) + 1);
}
console.log('无线段格子的来源层级分布:', JSON.stringify(Object.fromEntries([...bySource].sort())));
