# Nova Architecture — Tile System

更新日期：2026-09-12

本文件是瓦片系统架构的主题分片。它用于减少实施会话读取 `docs/architecture.md` 全文的 token 成本。

## 当前正式状态

- T021 旧路径 spatial replacement 自动/浏览器脚本通过，但人工 pan/zoom 体验失败。
- T023 TileEngineV2 已接入生产路径，但人工体验仍失败。
- T024/T025 的改动作为证据保留；它们没有让实际体验达到可接受状态。
- T026/T027 原 V2 补丁链已冻结，等待 T028 重新定义瓦片子系统路线。

## 旧路径隔离

- 旧 `TileMotionScheduler`、旧 Display Coverage 和旧 Tile Runtime 显示路径不得作为新的生产实现起点。
- `TileEngineV2` 相关模块不得被默认继续补丁式扩展；若新任务需要读取，必须由 `Task Context Packet` 明确列入 Allowed Files，并说明读取目的。
- 新瓦片路线只能默认复用已经确认的边界：KYE XYZ/MVT Source、Worker protocol v1、Polygon/Line geometry build、Three.js GPU upload、WebGPU/WebGL2 后端、Map3D 0.1 公共 API。

## 新路线前置要求

- 先建立 MapLibre 或其他可信开源实现的可运行基准，记录同场景请求时序、帧率、长任务、停止后请求和人工观感。
- 再完成源码映射：covering tiles、tile pyramid/source cache、request scheduler、tile cache、best-available render cover、upload/frame budget 到 Nova 模块的对应关系。
- 最后才允许创建新的瓦片实现任务；实现任务必须有严格的 Must Read、Allowed Files、Forbidden Files 和 Required Evidence。

## 验收边界

- 自动测试、headless 浏览器、截图和控制台无错误只能作为辅助证据。
- pan/zoom、初始化加载、停止后请求波次、白闪和卡顿必须由真实浏览器人工操作验收。
- 任何“指标通过但人工体验失败”的情况都以人工体验为阻断事实，返回决策会话重新拆分任务。

