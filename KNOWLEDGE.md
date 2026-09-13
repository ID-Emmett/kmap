# Nova Verified Knowledge Index

更新日期：2026-09-12

本文件是 Nova 已验证事实的轻量入口。默认启动只读本文件；需要细节时先按主题读取 `docs/knowledge/` 分片，再按证据索引追溯具体文件。

## 读取规则

- 默认读取：`KNOWLEDGE.md`。
- 主题细节：读取 `docs/knowledge/*.md` 中相关分片。
- 原始迁移归档：`docs/knowledge/full.md` 只在分片缺失、冲突或需要历史长文时按关键词局部读取。
- Evidence：先读 `docs/evidence/index.md`，再打开具体 JSON、截图、trace 或脚本。
- 新事实必须先有 research、代码、测试、浏览器或人工验收证据，再写入对应知识分片和本索引。

## 分片索引

| 主题 | 文件 | 默认用途 |
| --- | --- | --- |
| 数据协议与输入 | `docs/knowledge/data.md` | KYE MVT、fixture、style、动态业务数据、空瓦片和资源格式 |
| Tile Runtime | `docs/knowledge/tile-runtime.md` | TileKey、coverage、cache、TileEngineV2、调度/显示失败事实 |
| Rendering | `docs/knowledge/rendering.md` | Three.js 后端、Polygon/Line、视觉基线、网格伪影、渐隐 |
| Performance | `docs/knowledge/performance.md` | 浏览器性能、资源预算、long task、T016/T025 指标 |
| Environment | `docs/knowledge/environment.md` | 目标工作站、浏览器矩阵、验证边界和环境风险 |
| AI Governance | `docs/knowledge/ai-governance.md` | 低 token 入口、Task Context Packet、会话记录和治理门禁 |
| 完整归档 | `docs/knowledge/full.md` | 迁移前完整 `KNOWLEDGE.md`，非默认读取 |

## 当前高信号事实

- KYE 主瓦片是标准 Web Mercator XYZ、gzip HTTP 响应中的 MVT v2、extent 4096；部分专用空瓦片返回 HTTP 204。
- 当前 MVP 以真实 KYE 主 MVT、Three.js WebGPU/WebGL2、Worker Polygon/Line batch、Tile Runtime/Cache 和浅色 Playground 为核心。
- T011-T015 的规则网格伪影、浅色底图、渐进式替换、惯性交互和倾斜远景渐隐已通过人工体验验收。
- T016 已通过 Line geometry 复用解除 T010 city z10 资源阻断，但 128 MiB CPU cache 余量极小，仍是风险。
- T021/T023/T025 自动和浏览器脚本证据不能替代人工体验结论；人工负责人已明确报告 Tile 加载滞后、停止后波次、逐块出现和白闪仍存在。
- D031 已冻结既有补丁路线；D033 已确认 `NovaTileEngine` 方案，T030～T044 组成原任务链；T045 是针对 T042 首屏覆盖阻断新增的 LOD 修复任务。
- T042 生产双后端复跑确认 `MixedLODPlanner` 在 `minZoom=0`、初始 `zoom=15` 时仅计划 z=0 根 Tile，首屏为空；T045 已建立为 LOD 初始覆盖细化修复任务。
- `docs/project-state.md`、`docs/architecture/index.md`、`docs/decisions/index.md` 和 `pnpm ai:check` 已作为低 token 与强约束治理入口。

## 维护规则

- 本文件只放索引、读取规则和少量高信号事实，不承载长篇知识。
- 新知识优先写入对应分片；本文件只同步索引或一行高信号摘要。
- 不把会话讨论、猜测、候选方案或未复现问题写成已验证事实。
