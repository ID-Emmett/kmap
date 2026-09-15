# Kmap Knowledge — Environment

更新日期：2026-09-12

## 目标环境

- T010 主验证环境为 Windows 11 Pro `10.0.26100` 工作站。
- CPU：AMD Ryzen 9 8945HX（16C/32T）。
- GPU：AMD Radeon 610M 与 NVIDIA GeForce RTX 5060 Laptop GPU。
- 浏览器矩阵主证据为 Chrome/151；long task trace 收尾证据为 Chrome/152.0.7977.76。
- 代表性 viewport：1920×1080、DPR 约 1；早期截图也包含 1280×720、DPR 1.5 场景。
- 证据：`docs/evidence/T010-environment.json`、`docs/evidence/T010-longtask-trace.json`。

## 验证矩阵

- 自动：Unit、固定真实 KYE fixture integration、package integration、`pnpm check`。
- 浏览器：当前稳定 Chromium WebGPU、强制 WebGL2、无 WebGPU 自动 fallback。
- 体验：WebGPU/WebGL2、慢网、连续 pan/zoom、bearing/pitch、reduced-motion、offline/recovery、dispose。
- 性能：frame P95/P99、input response、worker/decode/build/upload、CPU/GPU bytes、Object count、long task 和 Chrome trace。

## 人工验收边界

- WebGPU/WebGL2、KYE 网络、浏览器交互和性能相关任务必须包含真实环境人工验证。
- 截图、控制台无错误和自动脚本指标是辅助证据，不能替代人工负责人对 pan/zoom 连续体验、白闪和卡顿的结论。
- 若人工验收与自动证据冲突，优先保留冲突并返回决策会话拆分阻断，不得把自动通过写成最终通过。

## 环境风险

- KYE 服务鉴权、CORS、缓存、节点降级和长期版本策略尚未完整验证。
- 完整字段 schema、Polygon hole、跨地域建筑数据和 source-layer 版本兼容仍只有有限样本。
- 设备丢失和真实发布目标设备性能尚未实现/测量；更换设备或浏览器/GPU 版本时必须重复关键矩阵。
