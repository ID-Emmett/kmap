# Kmap Decisions Index

更新日期：2026-09-13

本文件是重大决策的低 token 入口。默认读取本索引；只有当前任务明确关联某个决策时，再读取 `docs/decisions.md` 中的对应条目或 `docs/decisions/Dxxx-*.md` 分片。

## 读取规则

- 不默认全文读取所有历史决策。
- 实施会话只读取 `Task Context Packet` 列出的决策编号。
- 新决策优先写入独立分片，并在本索引登记；`docs/decisions.md` 只保留当前有效决策入口或摘要。

## 当前关键决策

| ID | 状态 | 主题 | 默认读取 |
| --- | --- | --- | --- |
| D001-D012 | Accepted | Monorepo、Three.js、WebGPU/WebGL2、TSL、Batch、Tile 生命周期、代码边界 | 仅公共架构问题 |
| D013-D021 | Accepted | MVP 范围、空间语义、Worker、Batch、API、验证、MVT 依赖 | 仅 MVP/API/Worker 问题 |
| D022-D029 | Accepted | 视觉基线、渐进替换、惯性、远景渐隐、Line 复用、mixed LOD、Retained Cache、fog-boundary | 仅渲染/瓦片体验问题 |
| D030 | Superseded by D031 | TileEngineV2 替换旧 Runtime 生产路径 | 仅作为失败路线和保留边界证据 |
| D031 | Accepted | 冻结 V2 补丁链，建立瓦片子系统重置与 AI 上下文隔离 | 瓦片失败路线默认读取 |
| D032 | Accepted | TileStreamingEngine 全新瓦片系统重建 | T029 默认读取 |
| D033 | Accepted | NovaTileEngine 任务化重建方案 | T031 默认读取 |

## 分片

- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`
- `docs/decisions/D032-tile-streaming-engine-clean-rebuild.md`
- `docs/decisions/D033-nova-tile-engine-plan.md`

## 归档入口

- `docs/decisions.md`：D001-D033 的当前文本归档；后续应逐步把新增重大决策写入独立分片，避免默认读取长文。
