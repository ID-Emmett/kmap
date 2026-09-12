# T002 Define MVP Project Control Baseline

## Goal

由 Project Control 会话确认 Nova MVP 的架构、数据结构、公共 API、任务拆分和验收基线。

## Scope

- 确认 MVP 范围和 Non-Goals。
- 确认世界坐标、局部坐标、浮动原点和相机约定。
- 确认 TileKey、可见 Tile、状态机、缓存、淘汰和失败策略。
- 确认 Worker、MVT 解码、Geometry、Batch 和 GPU 资源边界。
- 确认最小公共 API、错误模型、测试矩阵和性能基线。
- 将纵向链路拆分为可独立实施的 Tasks。

## Non-Goals

- 不直接实现地图核心功能。
- 不顺带升级 Three.js 或改变技术方向。
- 不把未验证的 KYE 推测写成正式设计前提。

## Inputs

- `AGENTS.md`、`PROJECT.md`、`TASKS.md`、`KNOWLEDGE.md`。
- `docs/architecture.md`、`docs/decisions.md`。
- `docs/research/` 全部资料，重点为 data、MVT 字典、style 和 reusable assets。

## Constraints

- Human-Governed；核心架构和公共 API 需要人工确认。
- 纵向链路优先：真实 KYE Tile → gzip → MVT → Polygon → Three.js → WebGPU。
- Feature 不创建独立 Object3D，Tile 是重要运行时管理单位。
- 新 Shader 统一使用 TSL。

## Acceptance Criteria

- MVP 范围、架构、公共 API 和关键数据结构均形成当前有效文档。
- 所有待决策项有明确结论或保留为显式 BLOCKED。
- 第一批 Implementation Tasks 可由新会话独立执行和验收。
- PROJECT、TASKS、architecture、decisions 同步更新。

## Test Plan

- 文档一致性审查。
- research 事实追溯检查。
- Task 依赖和验收标准审查。
- 架构风险与目标浏览器验证计划审查。

## Status

DONE

## Findings

- 已按 Project Control 顺序读取 `AGENTS.md`、`PROJECT.md`、`TASKS.md`、`KNOWLEDGE.md`、`docs/architecture.md`、`docs/decisions.md` 和 `docs/research/` 全部 10 份资料。
- 当前代码确认仍是 Bootstrap 空场景：没有 KYE 请求、MVT、Tile、LOD、Geometry、Layer style 或地图 Camera 语义。
- MVP 候选范围收窄为真实 KYE 主 MVT 的动态 Polygon/Line Tile Runtime；文字、完整 Style v8、3D 建筑、Picking、Raster 和业务 Overlay 移出 MVP。
- 坐标候选：公共 WGS84 ViewState；CPU Float64 Web Mercator meters；GPU Tile 局部 Float32；Three.js X 东/Y 上/Z 南；MapOrigin 随数据 Tile 重定位。
- Tile 候选：Canonical key 与 Render wrap 分离；状态机、请求去重、204 empty、重试、generation cancel、byte-aware LRU 和初始预算已经明确。
- Worker/Geometry 候选：主线程 Fetch/调度/GPU，Worker 解码/过滤/投影/Polygon/Line build；Tile 内按 layer/material 批处理并保留 feature mapping。
- GPU 候选：Map3D 根所有权、Tile 独占 Geometry、共享 Material registry、dispose 终态和 renderer loss fatal 策略已经明确。
- 公共 API、typed error/events/stats 和最小 fill/line Layer 配置已在 `docs/architecture.md` 给出精确候选。
- 自动测试、真实浏览器矩阵、场景、资源检查和初始性能门槛已写入 `docs/verification-baseline.md`。
- 已拆分 T003-T010；依赖允许坐标基础完成后并行推进 Worker 数据链和 Camera/Coverage，再汇合到动态 MVP 与性能验证。
- D013-D021 涉及 MVP、核心架构、公共 API、依赖与性能门槛，已于 2026-09-08 获人工负责人确认。
- 文档一致性检查确认 10 份 research、T001-T010 共 10 个 Task 文件、D001-D021 共 21 个唯一决策编号均存在。
- `pnpm check` 通过：严格类型检查、2 个 Vitest 测试、SDK build 和 Playground production build 均成功。

## Open Issues

- T010 的目标参考工作站尚未指定；不阻塞 T003-T009，但阻塞最终性能发布判断。
