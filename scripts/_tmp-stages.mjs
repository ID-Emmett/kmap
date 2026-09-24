/** 临时分析：按阶段输出绘制层级序列，对比首次与再次缩放的替换过程。 */
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const frames = j.frames ?? [], marks = j.marks ?? {};
const names = Object.keys(marks);
for (let i = 0; i < names.length; i += 2) {
  const from = marks[names[i]], to = marks[names[i + 1]] ?? frames.length;
  const slice = frames.slice(from, to);
  if (!slice.length) continue;
  // 压缩连续相同的层级组合，展示替换过程。
  const runs = [];
  for (const f of slice) {
    const last = runs[runs.length - 1];
    if (last && last.levels === f.levels) { last.n++; last.to = f.at; last.gapMax = Math.max(last.gapMax, f.gap ?? 0); continue; }
    runs.push({ levels: f.levels, n: 1, from: f.at, to: f.at, gapMax: f.gap ?? 0 });
  }
  const ink = slice.map(f => f.ink ?? 0);
  console.log(`\n=== ${names[i]} -> ${names[i + 1]} (${slice.length} 帧, ${Math.round((slice.at(-1).at - slice[0].at))}ms) ===`);
  console.log('  层级替换序列:', runs.slice(0, 14).map(r => `${r.levels || '(空)'}×${r.n}`).join(' → '));
  console.log('  回退级差最大', Math.max(...slice.map(f => f.gap ?? 0)), '| 淘汰', slice.at(-1).evict - slice[0].evict,
    '| 内容占比 min/中位', Math.min(...ink).toFixed(3), '/', ink.slice().sort((a, b) => a - b)[Math.floor(ink.length / 2)].toFixed(3));
  console.log('  前 12 帧样本:', slice.slice(0, 12).map(f => `${f.levels || '(空)'}@${f.gap}`).join(' '));
}
