# Nova Current Project State

更新日期：2026-09-13

本文件是 Nova AI 会话的低 token 启动入口。新会话先读本文件，再按会话类型和当前任务读取索引、任务文件和必要分片；不得用本文件替代 `PROJECT.md`、`TASKS.md`、任务文件、decisions、knowledge 或 evidence。

## 当前结论

- Nova 是 Human-Governed + Spec-Driven + Task-Driven + Evidence-Driven 的纯 AI Coding 工程。
- D033 已确认 `NovaTileEngine` 当前契约、架构模块、加载、调度、缓存、渲染、预算和验收标准。
- T030 已完成方案与任务依赖冻结。
- D033 已确认 `NovaTileEngine` 方案和 T030～T044 任务链；T031～T038 契约、空间覆盖、混合 LOD、运动调度、数据管线、分层缓存、Render Cover、上传预算和资源登记已完成，下一步为 T039 TileDiagnostics 与 Timeline。
- D031、D032 为历史路线治理记录。

## 当前任务状态

| Task | 状态 | 当前含义 |
| --- | --- | --- |
| T018 | BLOCKED | 历史任务记录 |
| T019 | BLOCKED | 历史任务记录 |
| T021 | BLOCKED | 历史任务记录 |
| T022 | BLOCKED | 历史任务记录 |
| T023 | BLOCKED | 历史任务记录 |
| T024 | DONE | 历史任务记录 |
| T025 | DONE | 历史任务记录 |
| T026 | BLOCKED | 历史任务记录 |
| T027 | BLOCKED | 历史任务记录 |
| T028 | DONE | 治理任务记录 |
| T029 | BLOCKED | 历史任务记录 |
| T030 | DONE | NovaTileEngine 方案与任务依赖已冻结 |
| T031 | DONE | 契约与独立命名空间 |
| T032 | DONE | TilePyramid 与 GroundFootprint |
| T033 | DONE | Mixed LOD 与 Pitch Cover |
| T034 | DONE | Motion Prediction 与 Request Scheduler |
| T035 | DONE | Fetch 与 Worker Pipeline |
| T036 | DONE | Layered Cache 与 Persistence |
| T037 | DONE | Render Cover 与 Cohort Commit |
| T038 | DONE | Upload Budget 与 Resource Registry |
| T039 | BACKLOG | TileDiagnostics 与 Timeline |
| T040 | BACKLOG | NovaTileEngine Integration Tests |
| T041 | BACKLOG | Dual Backend and Slow Network Verification |
| T042 | BACKLOG | NovaTileEngine Manual Acceptance |
| T043 | BACKLOG | Production Cutover and Runtime Deletion |
| T044 | BACKLOG | Post-Deletion Regression and Release Verification |

## 默认读取策略

- 决策会话：读 `AGENTS.md`、本文件、`TASKS.md`、`KNOWLEDGE.md`、`docs/ai-session-log.md`、`docs/session-types.md`、`docs/architecture/index.md`、`docs/decisions/index.md`，再按主题读取必要分片。
- 实施会话：读 `AGENTS.md`、本文件、`TASKS.md` 当前任务行、当前任务文件、当前任务的 `Task Context Packet`、`KNOWLEDGE.md`、`docs/evidence/index.md`、`docs/ai-session-log.md`。
- 默认读取 NTE 当前任务 Context Packet；详细记录、证据和归档按任务需要读取。

## AI 执行硬约束

- 所有非 DONE 的实施任务必须有 `Task Context Packet`；缺失时停止实施，返回决策会话补齐。
- 实施会话只执行一个已批准 Task；不得顺手扩大范围。
- 修改 Forbidden Files、公共 API、核心架构、MVP、默认预算、依赖或验收门槛时，必须停止并返回决策会话。
- NTE 实施任务使用独立命名空间和专属 Context Packet。
- T043 负责生产切换和运行时清理；T044 负责删除后验证。

## 关键索引

- 会话记录入口：`docs/ai-session-log.md`
- 知识入口：`KNOWLEDGE.md`
- Evidence 入口：`docs/evidence/index.md`
- 架构入口：`docs/architecture/index.md`
- 决策入口：`docs/decisions/index.md`
- 当前瓦片决策：`docs/decisions/D033-nova-tile-engine-plan.md`
- 当前瓦片架构：`docs/architecture/nova-tile-engine.md`
- 上下文包模板：`docs/task-context-packet-template.md`
- AI 治理知识：`docs/knowledge/ai-governance.md`
