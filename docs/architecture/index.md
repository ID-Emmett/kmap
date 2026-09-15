# Kmap Architecture Index

更新日期：2026-09-15

本文件是架构文档的低 token 入口。默认只读本索引；只有当前任务的 `Task Context Packet` 或决策问题明确需要时，才读取 `docs/architecture.md` 的对应章节或主题分片。

## 读取规则

- 新会话先读 `docs/project-state.md`，再读本索引。
- 实施会话只读取当前任务上下文包列出的架构章节。
- 不为“参考旧实现”全文读取 `docs/architecture.md`；需要扩大范围时返回决策会话确认。

## 主题入口

| 主题 | 默认入口 | 何时读取 |
| --- | --- | --- |
| 当前状态与约束 | `docs/project-state.md` | 所有会话默认读取 |
| 完整架构归档 | `docs/architecture.md` | 需要公共 API、坐标、Worker、Runtime、渲染完整边界时按章节读取 |
| 瓦片系统 | `docs/architecture/tile-system.md` | 涉及 Tile Runtime、TileEngineV2、TileStreamingEngine 或旧路径隔离时读取 |
| StreamingEngine | `docs/architecture/nova-tile-engine.md` | 当前接口、模块、加载、缓存、Worker 纹理、渲染与连续视觉验收 |
| 验证与性能 | `docs/verification-baseline.md` | 涉及浏览器矩阵、性能门槛、发布判断时读取 |
| 体验边界 | `docs/experience-baseline.md` | 涉及 pan/zoom、渐进加载、远景渐隐或人工体验时读取 |

## 当前架构入口

- `StreamingEngine` 当前规范：`docs/architecture/nova-tile-engine.md`。
- 瓦片公开资料与验收定义：`docs/research/streaming-rebuild-public-sources.md`。
- 当前实现和验证范围以 `docs/project-state.md` 与 StreamingEngine 规范为入口。
- 架构事实来自 decisions、任务完成记录、测试、evidence 或人工验收。
