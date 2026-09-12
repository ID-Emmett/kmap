# Nova Tasks

更新日期：2026-09-12

状态：`BACKLOG`、`IN_PROGRESS`、`BLOCKED`、`VERIFYING`、`DONE`。

| ID | Task | Status | Session | Depends On |
| --- | --- | --- | --- | --- |
| T001 | Bootstrap nova Monorepo | DONE | Bootstrap | - |
| T002 | Define MVP Project Control Baseline | DONE | Project Control | T001 |
| T003 | Implement Core Spatial Contracts | DONE | Implementation | T002 |
| T004 | Implement KYE Tile Fetch and MVT Decode | DONE | Implementation | T003 |
| T005 | Implement Worker Polygon Batch Pipeline | DONE | Implementation | T004 |
| T006 | Render Fixed KYE Polygon Vertical Slice | DONE | Implementation | T005 |
| T007 | Implement Camera and Visible Tile Coverage | DONE | Implementation | T003 |
| T008 | Implement Tile Runtime Cache and Lifecycle | DONE | Implementation | T004, T007 |
| T009 | Integrate Line Batches and Dynamic MVP Runtime | DONE | Implementation | T005, T006, T008 |
| T010 | Verify MVP Browser and Performance Baseline | DONE | Review / Performance | T009, T011, T012, T013, T014, T015 |
| T011 | Diagnose and Fix Regular Grid Watermark Artifact | DONE | Implementation / Debug | T009 |
| T012 | Implement Light Basemap Visual Baseline | DONE | Implementation | T011 |
| T013 | Implement Progressive Tile Replacement | DONE | Implementation | T011 |
| T014 | Implement Inertial Map Interaction | DONE | Implementation | T013 |
| T015 | Implement Pitched Horizon Fade | DONE | Implementation | T012, T013 |
| T016 | Reuse Line Geometry for Repeated Style Passes | DONE | Implementation / Performance | T010 |
| T017 | Implement Mixed-LOD Frustum Tile Selection | DONE | Implementation | T007, T008, T013, T015, T016 |
| T018 | Implement Motion-Aware Tile Scheduling | BLOCKED | Implementation / Performance | T014, T017 |
| T019 | Verify Pitched Tile Loading and LOD Baseline | BACKLOG | Review / Performance | T022, T027 |
| T020 | Fix Retained Tile Cache and Request Thrash | DONE | Implementation / Debug | T008, T013, T017 |
| T021 | Implement Spatial Best-Available Tile Replacement | VERIFYING | Implementation | T020 |
| T022 | Implement Fog-Bounded Pitched Coverage | BACKLOG | Implementation / Performance | T015, T017, T023, T024, T025, T026, T027 |
| T023 | Replace Custom Tile Runtime with TileEngineV2 | VERIFYING | Project Control / Architecture Migration | T008, T009, T017, T020, T021 |
| T024 | TileEngineV2 Render Transaction and Stable Cover | DONE | Implementation | T023 |
| T025 | TileEngineV2 Continuous Motion Scheduling | DONE | Implementation / Performance | T023, T024 |
| T026 | TileEngineV2 Coverage and Prefetch Budget Separation | BACKLOG | Implementation / Performance | T023, T025 |
| T027 | TileEngineV2 Diagnostic and Manual Acceptance | BACKLOG | Review / Performance | T024, T025, T026 |

## 当前任务

T021 的代码实现、自动验证和真实浏览器脚本已完成，但人工负责人明确验收不通过：pan/zoom 仍慢、停止后才集中出现、缺少有效预加载、Tile 逐块显示并伴随白闪。T021 保持 `VERIFYING`，其问题记录作为 T023 输入，不再继续给旧 Runtime 打补丁。T018 仍为 `BLOCKED`，其旧生产调度路径由 T023 替代；T022 和 T019 暂停到 V2 稳定后重新规划。

当前架构迁移任务为 T023：独立建立 `TileEngineV2`，借鉴 MapLibre/deck.gl 的已验证规则并保留现有 Three.js GPU 上传链路。虽然 T021 仍为 `VERIFYING`，T023 使用其已完成代码和失败证据作为输入，不等待 T021 被标记 `DONE`；V2 已接入 `Map3D` 唯一生产路径，但人工负责人验收已明确不通过。T024 已完成 Render transaction、初始 parent fallback 和空间完整 Render Cover 提交；T025 已完成运动中连续 refinement 调度与公平队列；T023 保持 `VERIFYING`，后续按 T026→T027 顺序修复和重新验收，不回到旧 Runtime 追加补丁。

执行顺序固定为：

1. T024 已完成真实 Render transaction、初始 coarse cover 和空间原子 replacement，先解决逐 Tile 提交与白闪。
2. T025 已移除 idle-only refinement 闸门，建立运动中连续加载与公平队列，解决停止后集中请求。
3. T026 分离 Coverage 与 prefetch 配额，在不提高总资源预算的前提下恢复预加载空间。
4. T027 运行逐帧诊断和真实 Chromium 人工验收；通过后关闭/更新 T023，并重新定义被其替代的 T018。
5. T022 接入 V2 的 fogStart/fogEnd/loadCutoff，再由 T019 完成最终发布验证。
6. T019 执行 V2 的双后端、慢网、资源、long task 和最终加载体验发布验证。

## 任务规则

- 每个实施会话只执行一个明确 Task。
- 任务范围、Non-Goals、输入、约束、验收和测试计划以任务文件为准。
- Project Control 负责新增、拆分、排序和批准后续 Implementation Tasks。
- 未经确认，不直接进入地图功能实现。
- T003-T025 的具体 Scope、Non-Goals、验收和测试以各自 Task 文件为准。
