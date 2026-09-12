# Nova Tasks

更新日期：2026-09-12

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
| T029 | Implement TileStreamingEngine Vertical Slice | BACKLOG | 实施会话 | T028 |

## 当前任务

T021 的代码实现、自动验证和真实浏览器脚本已完成，但人工负责人明确验收不通过：pan/zoom 仍慢、停止后才集中出现、缺少有效预加载、Tile 逐块显示并伴随白闪。T021 改为 `BLOCKED`，其问题记录只作为失败证据和后续重置输入，不再继续给旧 Runtime 打补丁。T018 仍为 `BLOCKED`，旧生产调度路径不再恢复实施。

T023 `TileEngineV2` 已接入 `Map3D` 唯一生产路径，并完成 T024 Render transaction 与 T025 运动调度补丁，但人工负责人在 T025 后仍明确反馈体验极差、帧率低、pan 卡顿、加载时序滞后、停止后请求波次、中心向外逐块加载和白闪。T023、T026、T027 均为 `BLOCKED`；不得继续按原 V2 补丁链推进。

T028 已完成瓦片子系统重置与上下文隔离决策输出。D032 确认新系统命名为 `TileStreamingEngine`，并将 T029 设为下一步实施任务。T029 不是 TileEngineV2 升级任务，而是删除或隔离旧生产瓦片路径并建立新引擎垂直切片。

执行顺序固定为：

1. 执行 T029，删除或隔离旧生产瓦片路径，建立 `TileStreamingEngine` 垂直切片。
2. T029 必须先实现 TilePyramid、TileCoverSelector、TileRequestScheduler、TileCache、TileUploadBudget、TileRenderCover 和 TileDiagnostics。
3. T029 必须通过通用不变量测试、真实 Chromium WebGPU/WebGL2 验证和人工交互验收。
4. T022 只能在 T029 人工接受后重新规划；不得接回已失败的 V2 补丁链。
5. T019 只能在新瓦片路线与 T022 重新完成后执行最终发布验证。
6. T024/T025 保留为已完成证据，不构成继续 T026/T027 的理由。

## 任务规则

- 每个实施会话只执行一个明确 Task。
- 任务范围、Non-Goals、输入、约束、验收和测试计划以任务文件为准。
- 决策会话负责新增、拆分、排序和批准后续实施任务。
- 新建或继续执行的实施任务必须包含 `Task Context Packet`，并明确 Allowed/Forbidden Files。
- 非 DONE 的实施任务缺少 `Task Context Packet` 时不得执行；必须先由决策会话补齐或重新定义。
- 未经确认，不直接进入地图功能实现。
- 当前默认下一步以 `docs/project-state.md` 和本文件一致结论为准。
- T003-T029 的具体 Scope、Non-Goals、验收和测试以各自 Task 文件为准。
