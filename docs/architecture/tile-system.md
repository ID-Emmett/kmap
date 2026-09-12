# Nova Architecture — Tile System

更新日期：2026-09-12

本文件是瓦片系统架构的主题分片。它用于减少实施会话读取 `docs/architecture.md` 全文的 token 成本。

## 当前正式状态

- T021 旧路径 spatial replacement 自动/浏览器脚本通过，但人工 pan/zoom 体验失败。
- T023 TileEngineV2 已接入生产路径，但人工体验仍失败。
- T024/T025 的改动作为证据保留；它们没有让实际体验达到可接受状态。
- T026/T027 原 V2 补丁链已冻结；T028 已完成重置输出。
- D032 已确认 `TileStreamingEngine` 为全新瓦片系统路线，T029 为下一步实施任务。

## 旧路径隔离

- 旧 `TileMotionScheduler`、旧 Display Coverage 和旧 Tile Runtime 显示路径不得作为新的生产实现起点。
- `TileEngineV2` 相关模块不得被默认继续补丁式扩展；T029 只能为删除、断开生产路径或 import guard 读取。
- 新瓦片路线只能默认复用已经确认的边界：KYE XYZ/MVT Source、Worker protocol v1、Polygon/Line geometry build、Three.js GPU upload、WebGPU/WebGL2 后端、Map3D 0.1 公共 API。

## TileStreamingEngine 路线

- `TileStreamingEngine` 是全新瓦片系统，不是 TileEngineV2 升级或补丁。
- T029 必须一次性建立 TilePyramid、TileCoverSelector、TileRequestScheduler、TileCache、TileUploadBudget、TileRenderCover 和 TileDiagnostics 垂直切片。
- 新路线采用业界通用不变量：完整 render cover、best-available fallback、原子替换、有界请求、有界 Worker、有界 upload、空间公平调度、缓存复用和资源预算。
- 新实现任务必须有严格的 Must Read、Allowed Files、Forbidden Files、Required Evidence 和 Stop Conditions。

## 验收边界

- 自动测试、headless 浏览器、截图和控制台无错误只能作为辅助证据。
- pan/zoom、初始化加载、停止后请求波次、白闪和卡顿必须由真实浏览器人工操作验收。
- 任何“指标通过但人工体验失败”的情况都以人工体验为阻断事实，返回决策会话重新拆分任务。
