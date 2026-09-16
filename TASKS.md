# Kmap Tasks

更新日期：2026-09-15

状态：`BACKLOG`、`IN_PROGRESS`、`BLOCKED`、`VERIFYING`、`DONE`。

会话类型只允许：`决策会话`、`实施会话`。调试、验证、性能分析、架构迁移是任务性质，不是独立会话身份。

| ID | Task | Status | Session Type | Depends On |
| --- | --- | --- | --- | --- |
| T001 | Bootstrap nova Monorepo | DONE | 实施会话 | - |
| T002 | Define MVP Decision Baseline | DONE | 决策会话 | T001 |
| T003 | Implement Core Spatial Contracts | DONE | 实施会话 | T002 |
| T004 | Implement KYE Tile Fetch and MVT Decode | DONE | 实施会话 | T003 |
| T005 | Implement Worker Polygon Batch Pipeline | DONE | 实施会话 | T004 |
| T006 | Render Fixed KYE Polygon Vertical Slice | DONE | 实施会话 | T005 |
| T007 | Implement Camera and Visible Tile Coverage | DONE | 实施会话 | T003 |
| T008 | Implement Tile Runtime Cache and Lifecycle | DONE | 实施会话 | T004, T007 |
| T009 | Integrate Line Batches and Dynamic MVP Runtime | DONE | 实施会话 | T005, T006, T008 |
| T010 | Verify MVP Browser and Performance Baseline | DONE | 实施会话 | T009, T011, T012, T013, T014, T015 |
| T011 | Diagnose and Fix Regular Grid Watermark Artifact | DONE | 实施会话 | T009 |
| T012 | Implement Light Basemap Visual Baseline | DONE | 实施会话 | T011 |
| T013 | Implement Progressive Tile Replacement | DONE | 实施会话 | T011 |
| T014 | Implement Inertial Map Interaction | DONE | 实施会话 | T013 |
| T015 | Implement Pitched Horizon Fade | DONE | 实施会话 | T012, T013 |
| T016 | Reuse Line Geometry for Repeated Style Passes | DONE | 实施会话 | T010 |
| T017 | Implement Mixed-LOD Frustum Tile Selection | DONE | 实施会话 | T007, T008, T013, T015, T016 |
| T018 | Implement Motion-Aware Tile Scheduling | BLOCKED | 实施会话 | T014, T017 |
| T019 | Verify Pitched Tile Loading and LOD Baseline | BLOCKED | 实施会话 | T022, T029 |
| T020 | Fix Retained Tile Cache and Request Thrash | DONE | 实施会话 | T008, T013, T017 |
| T021 | Implement Spatial Best-Available Tile Replacement | BLOCKED | 实施会话 | T020 |
| T022 | Implement Fog-Bounded Pitched Coverage | BLOCKED | 实施会话 | T015, T017, T029 |
| T023 | Replace Custom Tile Runtime with TileEngineV2 | BLOCKED | 实施会话 | T008, T009, T017, T020, T021 |
| T024 | TileEngineV2 Render Transaction and Stable Cover | DONE | 实施会话 | T023 |
| T025 | TileEngineV2 Continuous Motion Scheduling | DONE | 实施会话 | T023, T024 |
| T026 | TileEngineV2 Coverage and Prefetch Budget Separation | BLOCKED | 实施会话 | T023, T025 |
| T027 | TileEngineV2 Diagnostic and Manual Acceptance | BLOCKED | 实施会话 | T024, T025, T026 |
| T028 | Tile Subsystem Reset and AI Context Isolation | DONE | 决策会话 | T021, T023, T025 |
| T029 | Implement TileStreamingEngine Vertical Slice | BLOCKED | 实施会话 | T028 |
| T030 | NovaTileEngine Plan and Task Freeze | DONE | 决策会话 | T028 |
| T031 | NovaTileEngine Contract and Isolated Namespace | DONE | 实施会话 | T030 |
| T032 | TilePyramid and GroundFootprint | DONE | 实施会话 | T031 |
| T033 | Mixed LOD and Pitch Cover | DONE | 实施会话 | T032 |
| T034 | Motion Prediction and Request Scheduler | DONE | 实施会话 | T031 |
| T035 | Fetch and Worker Pipeline | DONE | 实施会话 | T031 |
| T036 | Layered Cache and Persistence | DONE | 实施会话 | T031 |
| T037 | Render Cover and Cohort Commit | DONE | 实施会话 | T032, T033 |
| T038 | Upload Budget and Resource Registry | DONE | 实施会话 | T035, T037 |
| T039 | TileDiagnostics and Timeline | DONE | 实施会话 | T034, T035, T036, T037, T038 |
| T040 | NovaTileEngine Integration Tests | DONE | 实施会话 | T031-T039 |
| T041 | Dual Backend and Slow Network Verification | DONE | 实施会话 | T040 |
| T042 | NovaTileEngine Manual Acceptance | BLOCKED | 实施会话 | T041 |
| T043 | Production Cutover and Runtime Deletion | DONE | 实施会话 | T042 |
| T044 | Post-Deletion Regression and Release Verification | BACKLOG | 实施会话 | T042, T043, T045, T046 |
| T045 | NovaTileEngine Initial Coverage Refinement Fix | DONE | 实施会话 | T041, T043 |
| T046 | Tile System Full Lifecycle and Streaming Repair | IN_PROGRESS | 实施会话 | T043, T045 |

## 当前任务

T046 当前承担标准瓦片系统修复、性能优化和 Playground 指标面板，状态为 IN_PROGRESS。其浏览器验收使用真实 KYE 数据和 WebGPU，入口为 `http://127.0.0.1:6661/`。当前实施边界与证据要求见 `tasks/T046-tile-system-full-lifecycle-repair.md`。

T031～T041 状态为 DONE，T043 生产切换和 T045 初始覆盖修复状态为 DONE。

T044 承担发布回归，发布范围由人工负责人确认。

## 任务规则

- 每个实施会话只执行一个明确 Task。
- 任务范围、Non-Goals、输入、约束、验收和测试计划以任务文件为准。
- 决策会话负责新增、拆分、排序和批准后续实施任务。
- 新建或继续执行的实施任务必须包含 `Task Context Packet`，并明确 Allowed/Forbidden Files。
- 非 DONE 的实施任务缺少 `Task Context Packet` 时不得执行；必须先由决策会话补齐或重新定义。
- 未经确认，不直接进入地图功能实现。
- 当前默认下一步以 `docs/project-state.md` 和本文件一致结论为准。
- T003-T044 的具体 Scope、Non-Goals、验收和测试以各自 Task 文件为准。
