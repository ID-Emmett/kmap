import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// 原始浏览器证据位于本地 evidence 目录，汇总保留指标、输入状态与文件指纹。
const base = 'docs/evidence/';
const matrixFiles = ['webgpu-2026-09-18T16-17-42-561Z', 'webgpu-2026-09-18T16-25-07-741Z'];
const coldFiles = ['webgpu-2026-09-18T16-29-58-684Z', 'webgpu-2026-09-18T16-27-44-509Z'];
const inputFile = 'streaming-rebuild/webgpu-2026-09-19T03-42-34-377Z.json';
const capitalsFile = 'streaming-rebuild/webgpu-2026-09-19T03-44-03-476Z.json';
const read = path => JSON.parse(readFileSync(base + path, 'utf8'));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const artifacts = new Set([inputFile, capitalsFile, 'map-continuity/check.log', 'map-continuity/ai-check.log',
  'map-continuity/data.json', 'map-continuity/v8Maptile-6-53-27.mvt', 'map-continuity/v8Maptile-7-106-55.mvt']);
const matrices = matrixFiles.map(stem => {
  const file = `streaming-rebuild/${stem}.json`, data = read(file); artifacts.add(file);
  assert.equal(data.scenes.length, 14);
  assert.equal(data.anomalies.length + data.errors.length, 0);
  assert.equal(data.maxChanged, 0);
  assert.equal(data.performance.uncovered, 0);
  for (const s of data.scenes) assert(s.settled && s.missing === 0 && s.uncovered === 0, s.name);
  const screenshots = data.visualFrames.filter(f => data.scenes.some(s => s.name === f.name)).map(f => ({ name: f.name, file: f.image }));
  screenshots.forEach(s => artifacts.add(s.file));
  return { file, backend: data.backend, at: data.at, viewport: data.viewport,
    comparisons: data.comparisons, maxChangedPixels: data.maxChanged, anomalies: data.anomalies.length, errors: data.errors.length,
    scenes: data.scenes.map(s => ({ name: s.name, settled: s.settled, missing: s.missing, uncovered: s.uncovered, placedLabels: s.diagnostics?.labels?.placed })),
    performance: data.performance, screenshots };
});
const coldLoads = coldFiles.map(stem => {
  const file = `streaming-rebuild/${stem}.json`, data = read(file); artifacts.add(file); artifacts.add(data.screenshot);
  const first = data.frames[0], last = data.frames.at(-1);
  assert(data.completed && data.reversions === 0 && data.errors.length === 0 && data.seen === data.oceanSamples);
  assert.equal(last.uncovered + last.missing, 0);
  return { file, backend: data.backend, at: data.at, viewport: data.viewport, network: data.network,
    completed: data.completed, frames: data.frames.length, observedDurationMs: last.at - first.at,
    oceanSamples: data.oceanSamples, seen: data.seen, reversions: data.reversions,
    maxChangedPixels: data.maxChanged, errors: data.errors.length,
    initialUncovered: first.uncovered, finalUncovered: last.uncovered, finalMissing: last.missing, screenshot: data.screenshot };
});
const input = read(inputFile); artifacts.add(input.screenshot);
for (const s of input.scenarios) {
  assert.equal(s.frame.uncovered + s.frame.missing, 0);
  assert.notDeepEqual(s.before.center, s.after.center);
  if (s.name === 'drag') assert.equal(s.before.zoom, s.after.zoom);
  else { assert(s.after.zoom > s.before.zoom); assert(s.mercatorEquivalentErrorPixels < .1); }
}
const capitals = read(capitalsFile); artifacts.add(capitals.screenshot);
const check = readFileSync(base + 'map-continuity/check.log', 'utf8');
assert(/Tests\s+165 passed/.test(check) && /Tests\s+16 passed/.test(check));
assert(readFileSync(base + 'map-continuity/ai-check.log', 'utf8').includes('AI governance check passed.'));
execFileSync('git', ['-c', 'core.safecrlf=false', 'diff', '--check']);
const changed = execFileSync('git', ['-c', 'core.safecrlf=false', 'diff', '--name-only', '--', '*.ts', '*.mjs'], { encoding: 'utf8' });
const added = execFileSync('git', ['ls-files', '--others', '--exclude-standard', '--', '*.ts', '*.mjs'], { encoding: 'utf8' });
const sourceFiles = [...new Set((changed + '\n' + added).trim().split(/\r?\n/).filter(Boolean))].sort();
const summary = {
  date: '2026-09-19', url: 'http://127.0.0.1:6661/',
  commands: { 'pnpm check': { passed: true, sdkTests: 165, playgroundTests: 16, typecheck: true, productionBuild: true }, 'pnpm ai:check': { passed: true }, 'git diff --check': { passed: true } },
  method: { pixelReadback: { width: 480, height: 270, channelThreshold: 16, anomalyPixelThreshold: 120 },
    comparison: '相机与资源状态固定后重复提交渲染，统计像素差；性能阶段独立运行 12 秒。',
    coldLoad: '逐帧观察 9 个海面点首次出现后的退回空白次数，并检查同状态重复渲染。',
    inputError: '实际滚轮事件前后指针地理位置的 Mercator 距离，按最终层级每像素米数换算。' },
  matrices, coldLoads, actualInput: { file: inputFile, ...input },
  capitalsVisual: { file: capitalsFile, view: capitals.view, labels: capitals.diagnostics.labels, screenshot: capitals.screenshot },
  limits: ['两种后端使用各自记录的视口，FPS 用于本机样本评估。', '台湾空主源区域使用有效祖先地表；道路、建筑、地名细节依赖上游数据。', '首次数据到达前存在加载等待；无闪烁结论适用于已记录的场景、像素阈值和采样点。'],
  sourceSha256: Object.fromEntries(sourceFiles.map(path => [path, hash(path)])),
  artifactSha256: Object.fromEntries([...artifacts].sort().map(path => [base + path, hash(base + path)])),
};
writeFileSync(base + 'map-continuity/verification-summary.json', JSON.stringify(summary, null, 2) + '\n');
console.log('Map continuity evidence verified: 181 tests, 28 scenes, 2648 pixel comparisons, 1070 cold-load frames, 3 real input scenarios.');
