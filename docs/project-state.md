# Kmap Current Project State

更新日期：2026-09-20

本文件是 Kmap AI 会话的低 token 启动入口。新会话先读本文件，再按会话类型和当前任务读取索引、任务文件和必要分片；不得用本文件替代 `PROJECT.md`、`TASKS.md`、任务文件、decisions、knowledge 或 evidence。

## 当前结论

- 当前瓦片采用 canonical 数据身份、GPU 管线准备后发布、父到子完整来源模板和逐采样点所有权；道路使用缩放曲线，文字采用持久身份与连续显隐。实现规范见 `docs/architecture/maplibre-aligned-streaming.md`，验证入口为 `docs/evidence/maplibre-alignment/README.md`。
- 城市平面地图在 z4.5～5.5 连续过渡到地球；Inspector 支持三主题、地图元素和文字样式编辑。默认背景/雾为 #dbdeff，陆地为 #e6f4f3。近景精度、地名层级和瓦片加载验证见 `docs/evidence/map-inspector/README.md`。

- Kmap 采用 Human-Governed、Spec-Driven、Task-Driven 和 Evidence-Driven 工作方式。
- 当前生产瓦片运行时为 `StreamingEngine`，位于 `packages/map3d/src/streaming/`，负责 XYZ 覆盖、Worker 矢量面、中心线实例与挤出建筑、多单位线宽、加载、缓存、帧提交和资源回收。
- 当前画质支持 75° 强雾与统一目标层级、15.74 建筑门槛、kind 分类色、国省界和连续虚线；证据入口为 `docs/evidence/map-quality/README.md`。
- T046 状态为 IN_PROGRESS，范围包含瓦片系统、性能指标面板和真实 WebGPU 验收。
- 浏览器入口为 `http://127.0.0.1:6661/`，当前瓦片系统的时序、录像与视觉审查证据位于 `docs/evidence/streaming-rebuild/`。
- 当前双后端性能、连续覆盖和视觉检查事实见 `docs/knowledge/streaming.md`。
- Playground 生产构建输出 `index.html` 与 `playground.js`，真实 WebGPU Preview 的瓦片显示证据见 `docs/evidence/streaming-rebuild/T046-playground-preview-build.json`。

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
| T039 | DONE | TileDiagnostics 与 Timeline |
| T040 | DONE | NovaTileEngine Integration Tests |
| T041 | DONE | Dual Backend and Slow Network Verification |
| T042 | BLOCKED | NovaTileEngine Manual Acceptance |
| T043 | DONE | Production Cutover and Runtime Deletion |
| T044 | BACKLOG | Post-Deletion Regression and Release Verification |
| T045 | DONE | NovaTileEngine Initial Coverage Refinement Fix |
| T046 | IN_PROGRESS | 标准瓦片系统与性能面板验收 |

## 默认读取策略

- 决策会话：读 `AGENTS.md`、本文件、`TASKS.md`、`KNOWLEDGE.md`、`docs/ai-session-log.md`、`docs/session-types.md`、`docs/architecture/index.md`、`docs/decisions/index.md`，再按主题读取必要分片。
- 实施会话：读 `AGENTS.md`、本文件、`TASKS.md` 当前任务行、当前任务文件、当前任务的 `Task Context Packet`、`KNOWLEDGE.md`、`docs/evidence/index.md`、`docs/ai-session-log.md`。
- 默认读取 NTE 当前任务 Context Packet；详细记录、证据和归档按任务需要读取。

## AI 执行硬约束

- 所有非 DONE 的实施任务必须有 `Task Context Packet`；缺失时停止实施，返回决策会话补齐。
- 实施会话只执行一个已批准 Task；不得顺手扩大范围。
- 修改 Forbidden Files、公共 API、核心架构、MVP、默认预算、依赖或验收门槛时，必须停止并返回决策会话。
- NTE 实施任务使用独立命名空间和专属 Context Packet。
- T045 已完成 NTE 初始覆盖与细化规划修复；T046 负责全量生命周期、回收、调度和倾斜覆盖修复；T042 负责修复后的生产人工验收；T044 负责删除后回归和发布验证。

## 关键索引

- 治理决策入口：D031、D032、D033，详见 `docs/decisions/index.md`。

- 会话记录入口：`docs/ai-session-log.md`
- 知识入口：`KNOWLEDGE.md`
- Evidence 入口：`docs/evidence/index.md`
- 架构入口：`docs/architecture/index.md`
- 决策入口：`docs/decisions/index.md`
- 当前瓦片决策：`docs/decisions/D033-nova-tile-engine-plan.md`
- 当前瓦片架构：`docs/architecture/nova-tile-engine.md`
- 上下文包模板：`docs/task-context-packet-template.md`
- AI 治理知识：`docs/knowledge/ai-governance.md`
