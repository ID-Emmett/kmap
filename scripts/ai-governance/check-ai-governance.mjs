import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const requiredFiles = [
  'AGENTS.md',
  'PROJECT.md',
  'TASKS.md',
  'KNOWLEDGE.md',
  'docs/project-state.md',
  'docs/ai-session-log.md',
  'docs/session-types.md',
  'docs/task-context-packet-template.md',
  'docs/architecture/index.md',
  'docs/architecture/tile-system.md',
  'docs/architecture/nova-tile-engine.md',
  'docs/decisions/index.md',
  'docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md',
  'docs/decisions/D032-tile-streaming-engine-clean-rebuild.md',
  'docs/decisions/D033-nova-tile-engine-plan.md',
  'docs/evidence/index.md',
  'docs/knowledge/ai-governance.md',
  'docs/knowledge/tile-runtime.md',
];

const taskFileById = new Map([
  ['T001', 'tasks/T001-bootstrap-nova-monorepo.md'],
  ['T002', 'tasks/T002-project-control-mvp-baseline.md'],
  ['T003', 'tasks/T003-core-spatial-contracts.md'],
  ['T004', 'tasks/T004-kye-tile-fetch-mvt-decode.md'],
  ['T005', 'tasks/T005-worker-polygon-batch.md'],
  ['T006', 'tasks/T006-fixed-kye-polygon-vertical-slice.md'],
  ['T007', 'tasks/T007-camera-visible-tile-coverage.md'],
  ['T008', 'tasks/T008-tile-runtime-cache-lifecycle.md'],
  ['T009', 'tasks/T009-line-dynamic-mvp-integration.md'],
  ['T010', 'tasks/T010-mvp-browser-performance-baseline.md'],
  ['T011', 'tasks/T011-fix-global-grid-artifact.md'],
  ['T012', 'tasks/T012-light-basemap-visual-style.md'],
  ['T013', 'tasks/T013-progressive-tile-replacement.md'],
  ['T014', 'tasks/T014-inertial-map-interaction.md'],
  ['T015', 'tasks/T015-pitched-horizon-fade.md'],
  ['T016', 'tasks/T016-line-geometry-reuse.md'],
  ['T017', 'tasks/T017-mixed-lod-tile-selection.md'],
  ['T018', 'tasks/T018-motion-aware-tile-scheduling.md'],
  ['T019', 'tasks/T019-verify-pitched-tile-loading.md'],
  ['T020', 'tasks/T020-retained-tile-cache.md'],
  ['T021', 'tasks/T021-spatial-tile-replacement.md'],
  ['T022', 'tasks/T022-fog-bounded-pitched-coverage.md'],
  ['T023', 'tasks/T023-tile-engine-v2.md'],
  ['T024', 'tasks/T024-tile-engine-v2-render-transaction.md'],
  ['T025', 'tasks/T025-tile-engine-v2-motion-scheduling.md'],
  ['T026', 'tasks/T026-tile-engine-v2-coverage-prefetch-budget.md'],
  ['T027', 'tasks/T027-tile-engine-v2-manual-acceptance.md'],
  ['T028', 'tasks/T028-tile-subsystem-reset-context-isolation.md'],
  ['T029', 'tasks/T029-implement-tile-streaming-engine.md'],
  ['T030', 'tasks/T030-novatileengine-plan.md'],
  ['T031', 'tasks/T031-novatileengine-contract.md'],
  ['T032', 'tasks/T032-novatileengine-pyramid-footprint.md'],
  ['T033', 'tasks/T033-novatileengine-lod-cover.md'],
  ['T034', 'tasks/T034-novatileengine-scheduler.md'],
  ['T035', 'tasks/T035-novatileengine-pipeline.md'],
  ['T036', 'tasks/T036-novatileengine-cache.md'],
  ['T037', 'tasks/T037-novatileengine-render-cover.md'],
  ['T038', 'tasks/T038-novatileengine-upload-resources.md'],
  ['T039', 'tasks/T039-novatileengine-diagnostics.md'],
  ['T040', 'tasks/T040-novatileengine-integration-tests.md'],
  ['T041', 'tasks/T041-novatileengine-browser-verification.md'],
  ['T042', 'tasks/T042-novatileengine-manual-acceptance.md'],
  ['T043', 'tasks/T043-novatileengine-cutover-delete.md'],
  ['T044', 'tasks/T044-novatileengine-release-verification.md'],
  ['T045', 'tasks/T045-novatileengine-initial-coverage-fix.md'],
  ['T046', 'tasks/T046-tile-system-full-lifecycle-repair.md'],
  ['T047', 'tasks/T047-interaction-smoothness-hardening.md'],
  ['T048', 'tasks/T048-material-slot-rendering.md'],
]);

const errors = [];
const warnings = [];

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function exists(relativePath) {
  return existsSync(path.join(root, relativePath));
}

function listMarkdownFiles(relativePath) {
  const fullPath = path.join(root, relativePath);
  if (!existsSync(fullPath)) {
    return [];
  }
  if (statSync(fullPath).isFile()) {
    return relativePath.endsWith('.md') ? [relativePath] : [];
  }
  const files = [];
  for (const entry of readdirSync(fullPath)) {
    files.push(...listMarkdownFiles(path.join(relativePath, entry).replaceAll(path.sep, '/')));
  }
  return files;
}

function lineCount(text) {
  return text.split(/\r?\n/).length;
}

for (const file of requiredFiles) {
  if (!exists(file)) {
    errors.push(`缺少必需治理文件：${file}`);
  }
}

if (exists('docs/project-state.md')) {
  const text = read('docs/project-state.md');
  const lines = lineCount(text);
  if (lines > 160) {
    errors.push(`docs/project-state.md 过长：${lines} 行，目标不超过 160 行`);
  }
for (const token of ['T030', 'T031', 'T028', 'T029', 'T026', 'T027', 'D031', 'D032', 'D033', 'docs/architecture/index.md', 'docs/decisions/index.md']) {
    if (!text.includes(token)) {
      errors.push(`docs/project-state.md 缺少关键入口或状态：${token}`);
    }
  }
}

const documentationPolicyFiles = [
  'AGENTS.md',
  'docs/knowledge/ai-governance.md',
  'docs/task-context-packet-template.md',
];

for (const file of documentationPolicyFiles) {
  if (!exists(file)) {
    continue;
  }
  const text = read(file);
  for (const token of ['正式规范文档', '证据索引', '讨论过程', '废弃细节']) {
    if (!text.includes(token)) {
      errors.push(`${file} 缺少正式文档污染控制规则：${token}`);
    }
  }
}

const formalDocumentationTargets = [
  'AGENTS.md',
  'PROJECT.md',
  'TASKS.md',
  'KNOWLEDGE.md',
  'docs/project-state.md',
  'docs/session-types.md',
  'docs/task-context-packet-template.md',
  'docs/architecture',
  'docs/decisions',
  'docs/knowledge',
  'docs/research',
  'docs/evidence',
  'tasks',
];
const documentationPollutionPattern = /我建议|我认为|我觉得|你提到|你说|用户说|用户认为|我们讨论|先探讨|这次先|阶段性判断|废弃方案细节|对话式解释/;

for (const target of formalDocumentationTargets) {
  for (const file of listMarkdownFiles(target)) {
    const text = read(file);
    text.split(/\r?\n/).forEach((line, index) => {
      if (documentationPollutionPattern.test(line)) {
        errors.push(`${file}:${index + 1} 正式文档疑似包含过程/对话污染：${line.trim()}`);
      }
    });
  }
}

const tasksText = exists('TASKS.md') ? read('TASKS.md') : '';
const taskRows = [];
for (const line of tasksText.split(/\r?\n/)) {
  const match = line.match(/^\|\s*(T\d{3})\s*\|\s*([^|]+)\|\s*(BACKLOG|IN_PROGRESS|BLOCKED|VERIFYING|DONE)\s*\|\s*([^|]+)\|\s*([^|]+)\|/);
  if (match) {
    taskRows.push({
      id: match[1],
      title: match[2].trim(),
      status: match[3],
      sessionType: match[4].trim(),
      dependsOn: match[5].trim(),
    });
  }
}

if (taskRows.length === 0) {
  errors.push('TASKS.md 未解析到任务表。');
}

for (const row of taskRows) {
  const taskFile = taskFileById.get(row.id);
  if (!taskFile) {
    errors.push(`TASKS.md 中 ${row.id} 没有登记任务文件映射。`);
    continue;
  }
  if (!exists(taskFile)) {
    errors.push(`${row.id} 缺少任务文件：${taskFile}`);
    continue;
  }
  const taskText = read(taskFile);
  const statusMatch = taskText.match(/## Status\s+([A-Z_]+)/m);
  if (!statusMatch) {
    errors.push(`${taskFile} 缺少 ## Status。`);
  } else if (statusMatch[1] !== row.status) {
    errors.push(`${row.id} 状态不一致：TASKS.md=${row.status}，任务文件=${statusMatch[1]}`);
  }
  if (row.status !== 'DONE' && !taskText.includes('## Task Context Packet')) {
    errors.push(`${row.id} 非 DONE 任务缺少 Task Context Packet：${taskFile}`);
  }
}

const implementationOpenTasks = taskRows.filter((row) => row.status !== 'DONE' && row.sessionType === '实施会话');
for (const row of implementationOpenTasks) {
  const taskFile = taskFileById.get(row.id);
  if (!taskFile || !exists(taskFile)) {
    continue;
  }
  const taskText = read(taskFile);
  for (const heading of ['### Must Read', '### Read If Needed', '### Allowed Files', '### Forbidden Files', '### Required Evidence', '### Stop Conditions']) {
    if (!taskText.includes(heading)) {
      errors.push(`${row.id} Task Context Packet 缺少章节：${heading}`);
    }
  }
}

const statusById = new Map(taskRows.map((row) => [row.id, row.status]));
for (const [id, expected] of [
  ['T019', 'BLOCKED'],
  ['T021', 'BLOCKED'],
  ['T022', 'BLOCKED'],
  ['T023', 'BLOCKED'],
  ['T026', 'BLOCKED'],
  ['T027', 'BLOCKED'],
  ['T028', 'DONE'],
  ['T029', 'BLOCKED'],
  ['T030', 'DONE'],
  ['T031', 'DONE'],
  ['T032', 'DONE'],
  ['T033', 'DONE'],
  ['T034', 'DONE'],
  ['T035', 'DONE'],
  ['T036', 'DONE'],
  ['T037', 'DONE'],
  ['T038', 'DONE'],
  ['T039', 'DONE'],
  ['T040', 'DONE'],
  ['T041', 'DONE'],
  ['T042', 'BLOCKED'],
  ['T043', 'DONE'],
  ['T044', 'BACKLOG'],
  ['T045', 'DONE'],
  ['T046', statusById.get('T046') ?? 'MISSING'],
  ['T047', statusById.get('T047') ?? 'MISSING'],
  ['T048', statusById.get('T048') ?? 'MISSING'],
]) {
  if (statusById.get(id) !== expected) {
    errors.push(`当前路线状态错误：${id} 应为 ${expected}，实际为 ${statusById.get(id) ?? '缺失'}`);
  }
}

if (/执行 T026，分离 Coverage 与 prefetch/.test(tasksText) || /T026→T027/.test(tasksText)) {
  errors.push('TASKS.md 仍包含 T026→T027 作为默认下一步的旧路线。');
}
if (!/T031～T041/.test(tasksText) || !/\|\s*T042\s*\|\s*NovaTileEngine Manual Acceptance\s*\|\s*BLOCKED/.test(tasksText)) {
  errors.push('TASKS.md 未登记 T031～T041 完成及 T042 当前阻断状态。');
}

const projectState = exists('docs/project-state.md') ? read('docs/project-state.md') : '';
for (const [id, expected] of [
  ['T023', 'BLOCKED'],
  ['T026', 'BLOCKED'],
  ['T027', 'BLOCKED'],
  ['T028', 'DONE'],
  ['T029', 'BLOCKED'],
  ['T030', 'DONE'],
  ['T031', 'DONE'],
  ['T032', 'DONE'],
  ['T033', 'DONE'],
  ['T037', 'DONE'],
  ['T038', 'DONE'],
  ['T039', 'DONE'],
  ['T034', 'DONE'],
  ['T035', 'DONE'],
  ['T036', 'DONE'],
  ['T040', 'DONE'],
  ['T041', 'DONE'],
  ['T042', 'BLOCKED'],
  ['T045', 'DONE'],
  ['T046', statusById.get('T046') ?? 'MISSING'],
  ['T047', 'DONE'],
  ['T048', 'BACKLOG'],
]) {
  const rowPattern = new RegExp(`\\|\\s*${id}\\s*\\|\\s*${expected}\\s*\\|`);
  if (!rowPattern.test(projectState)) {
    errors.push(`docs/project-state.md 中 ${id} 状态未登记为 ${expected}。`);
  }
}

if (exists('docs/decisions/index.md')) {
  const decisionsIndex = read('docs/decisions/index.md');
  if (!/D030\s*\|\s*Superseded by D031/.test(decisionsIndex)) {
    errors.push('docs/decisions/index.md 未标记 D030 被 D031 取代。');
  }
  if (!/D031\s*\|\s*Accepted/.test(decisionsIndex)) {
    errors.push('docs/decisions/index.md 未登记 D031 Accepted。');
  }
  if (!/D032\s*\|\s*Accepted/.test(decisionsIndex)) {
    errors.push('docs/decisions/index.md 未登记 D032 Accepted。');
  }
  if (!/D033\s*\|\s*Accepted/.test(decisionsIndex)) {
    errors.push('docs/decisions/index.md 未登记 D033 Accepted。');
  }
}

if (exists('docs/decisions.md')) {
  const decisions = read('docs/decisions.md');
  if (!decisions.includes('## D031')) {
    errors.push('docs/decisions.md 缺少 D031 摘要。');
  }
  if (!decisions.includes('## D032')) {
    errors.push('docs/decisions.md 缺少 D032 摘要。');
  }
  if (!decisions.includes('## D033')) {
    errors.push('docs/decisions.md 缺少 D033 摘要。');
  }
  if (!/## D030[\s\S]*?- 状态：Superseded by D031/.test(decisions)) {
    errors.push('docs/decisions.md 未标记 D030 为 Superseded by D031。');
  }
}

if (exists('docs/ai-session-log.md')) {
  const log = read('docs/ai-session-log.md');
  if (!log.includes('docs/ai-sessions/YYYY-MM-DD.md')) {
    warnings.push('docs/ai-session-log.md 未说明按日期拆分详细记录。');
  }
}

if (errors.length > 0) {
  console.error('AI governance check failed:');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  if (warnings.length > 0) {
    console.error('Warnings:');
    for (const warning of warnings) {
      console.error(`- ${warning}`);
    }
  }
  process.exit(1);
}

console.log('AI governance check passed.');
console.log(`- Required governance files: ${requiredFiles.length}`);
console.log(`- Parsed tasks: ${taskRows.length}`);
console.log(`- Open implementation tasks with context packets: ${implementationOpenTasks.length}`);
console.log(`- Current implementation: T046=${statusById.get('T046')}; task files and project-state index agree.`);
console.log('- Formal documentation gate: policy anchors and pollution scan active.');
if (warnings.length > 0) {
  console.log('Warnings:');
  for (const warning of warnings) {
    console.log(`- ${warning}`);
  }
}
