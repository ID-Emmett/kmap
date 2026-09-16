# Kmap Verified Knowledge Index

更新日期：2026-09-15

本文件是 Kmap 已验证事实的轻量入口。默认启动只读本文件；需要细节时先按主题读取 `docs/knowledge/` 分片，再按证据索引追溯具体文件。

## 读取规则

- 默认读取：`KNOWLEDGE.md`。
- 主题细节：读取 `docs/knowledge/*.md` 中相关分片。
- Evidence：先读 `docs/evidence/index.md`，再打开具体 JSON、截图、trace 或脚本。
- 新事实必须先有 research、代码、测试、浏览器或人工验收证据，再写入对应知识分片和本索引。

## 分片索引

| 主题 | 文件 | 默认用途 |
| --- | --- | --- |
| StreamingEngine | `docs/knowledge/streaming.md` | 当前 MVT 绘制、加载、覆盖、缓存、LOD、雾和连续浏览器证据 |
| 数据协议与输入 | `docs/knowledge/data.md` | KYE MVT、fixture、style、动态业务数据、空瓦片和资源格式 |
| Tile Runtime | `docs/knowledge/tile-runtime.md` | TileKey、coverage、cache、TileEngineV2、调度/显示失败事实 |
| Rendering | `docs/knowledge/rendering.md` | Three.js 后端、Polygon/Line、视觉基线、网格伪影、渐隐 |
| Performance | `docs/knowledge/performance.md` | 浏览器性能、资源预算、long task、T016/T025 指标 |
| Environment | `docs/knowledge/environment.md` | 目标工作站、浏览器矩阵、验证边界和环境风险 |
| AI Governance | `docs/knowledge/ai-governance.md` | 低 token 入口、Task Context Packet、会话记录和治理门禁 |

## 当前高信号事实

- KYE 主源部分海面瓦片返回 204；专用海洋来源、中文 glyph PBF 和字段样本已验证。当前实现与浏览器验收边界见 `docs/evidence/map-stability/README.md`，文字方案见 `docs/research/map-label-system-2026-09-16.md`。

- KYE 主瓦片是标准 Web Mercator XYZ、gzip HTTP 响应中的 MVT v2、extent 4096；部分专用空瓦片返回 HTTP 204。
- 当前 MVP 使用真实 KYE 主 MVT、Worker 矢量面、中心线实例与挤出建筑、Three.js TSL 视图线宽、StreamingEngine 和浅色 Playground。
- 当前瓦片架构、数据响应与验证事实见 `docs/knowledge/streaming.md`。
- `docs/project-state.md`、`docs/architecture/index.md`、`docs/decisions/index.md` 和 `pnpm ai:check` 已作为低 token 与强约束治理入口。

## 维护规则

- 本文件只放索引、读取规则和少量高信号事实，不承载长篇知识。
- 新知识优先写入对应分片；本文件只同步索引或一行高信号摘要。
- 不把会话讨论、猜测、候选方案或未复现问题写成已验证事实。
