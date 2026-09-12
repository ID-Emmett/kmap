# Nova AI Engineering Optimization Report

日期：2026-09-12

## 目标

本次优化目标是让 Nova 更适合纯 AI Coding：低 token、低上下文污染、强任务边界、可追溯、可机器检查，并避免后续 AI 会话继续沿已失败的 TileEngineV2 补丁路线执行。

## 已实施优化

### 1. 正式状态校准

- 将 T021/T023/T026/T027 的失败或冻结状态同步到 `TASKS.md`、`PROJECT.md`、任务文件和 `docs/project-state.md`。
- 新增 D031，正式冻结 T026/T027 的 V2 补丁链。
- 新增 T028 作为当前唯一合法下一步：瓦片子系统重置与 AI 上下文隔离。

### 2. 低 token 当前状态入口

- 新增 `docs/project-state.md`，作为新会话默认读取的短入口。
- 该文件只保留当前结论、任务状态、默认读取策略、硬约束和关键索引。
- 目标是让 AI 不再为了判断当前方向而读取整份 architecture、decisions、evidence 或历史会话。

### 3. 非 DONE 任务上下文包补齐

- 为 T018、T019、T021、T022、T023 补充 `Task Context Packet`。
- T026/T027 已有上下文包，但本次收紧为 BLOCKED 状态下只允许治理记录，不再允许默认修改 V2 源码。
- T028 自带上下文包，用于后续瓦片重置决策入口。

### 4. 架构与决策索引/分片

- 新增 `docs/architecture/index.md` 和 `docs/architecture/tile-system.md`。
- 新增 `docs/decisions/index.md` 和 `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`。
- `docs/architecture.md` 和 `docs/decisions.md` 保留为完整归档，但不再作为普通会话默认全文读取对象。

### 5. 自动治理门禁

- 新增 `scripts/ai-governance/check-ai-governance.mjs`。
- 新增 `pnpm ai:check`。
- 检查内容包括：必需治理文件、project-state 行数、任务状态一致性、非 DONE 任务上下文包、D030/D031 状态、T028 唯一下一步、T026/T027 阻断状态。

## Token 节省机制

- 新会话默认读取 `docs/project-state.md`、`KNOWLEDGE.md`、`docs/ai-session-log.md`、`docs/architecture/index.md`、`docs/decisions/index.md` 和 `docs/evidence/index.md`。
- 详细材料只按任务号、决策号、主题关键词或 evidence 文件名局部读取。
- 大文件不再默认进入上下文：`docs/architecture.md`、`docs/decisions.md`、`docs/knowledge/full.md`、`docs/evidence/` 大型 JSON/PNG/trace 和无关旧任务。
- 会话记录继续保留用户原话，但通过 `docs/ai-session-log.md` 索引和按日文件降低默认读取成本。

## 准确性与执行约束

- 非 DONE 的实施任务缺少 `Task Context Packet` 时，AI 不得实施。
- 修改 Forbidden Files、公共 API、核心架构、MVP、默认预算、依赖或验收门槛时，必须返回决策会话。
- 人工体验失败优先级高于自动测试、截图和 headless 浏览器脚本。
- T026/T027 不再是默认下一步；T028 是唯一合法入口。

## 最终检查

- `pnpm ai:check`：通过。
- `git diff --check`：通过。
- `pnpm check`：通过，包含 SDK/Playground typecheck、34 个 map3d 测试文件 179 项测试、2 个 playground 测试文件 4 项测试、SDK 与 Playground production build。

## 后续建议

- 执行 T028，而不是继续瓦片补丁。
- T028 之后至少拆出四个任务：MapLibre 基准、源码映射、旧实现隔离、全新瓦片实现。
- 后续每个新任务必须先写 `Task Context Packet`，再允许实施。
