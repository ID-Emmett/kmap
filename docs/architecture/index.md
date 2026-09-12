# Nova Architecture Index

更新日期：2026-09-12

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
| 瓦片系统 | `docs/architecture/tile-system.md` | 涉及 Tile Runtime、TileEngineV2、V3/重置或旧路径隔离时读取 |
| 验证与性能 | `docs/verification-baseline.md` | 涉及浏览器矩阵、性能门槛、发布判断时读取 |
| 体验边界 | `docs/experience-baseline.md` | 涉及 pan/zoom、渐进加载、远景渐隐或人工体验时读取 |

## 当前架构风险

- TileEngineV2 已经形成自动证据，但人工体验失败；T026/T027 补丁链已冻结，不能作为默认下一步。
- 后续瓦片实现必须先完成 T028，定义旧代码隔离边界、可复用接口和新实现上下文包。
- 架构事实必须来自 decisions、任务完成记录、测试、evidence 或人工验收；会话记录中的讨论不得直接升级为事实。

