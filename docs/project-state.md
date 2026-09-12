# Nova Current Project State

更新日期：2026-09-12

本文件是 Nova AI 会话的低 token 启动入口。新会话先读本文件，再按会话类型和当前任务读取索引、任务文件和必要分片；不得用本文件替代 `PROJECT.md`、`TASKS.md`、任务文件、decisions、knowledge 或 evidence。

## 当前结论

- Nova 是 Human-Governed + Spec-Driven + Task-Driven + Evidence-Driven 的纯 AI Coding 工程。
- 当前最高风险不是缺少更多补丁，而是正式状态、任务路线和人工体验结论发生漂移。
- T021/T023/T025 的自动测试和浏览器脚本不能替代人工体验结论；人工负责人已明确报告 pan/zoom 加载滞后、停止后请求波次、中心向外逐块加载、白闪和明显卡顿。
- D031 已冻结 T026/T027 原 V2 补丁链；不得在未完成 T028 前继续执行。
- 下一步唯一合法入口是 T028：瓦片子系统重置与 AI 上下文隔离。

## 当前任务状态

| Task | 状态 | 当前含义 |
| --- | --- | --- |
| T018 | BLOCKED | 旧 Runtime motion-aware 路径不再恢复实施 |
| T019 | BLOCKED | 最终发布验证等待瓦片重置路线重新定义 |
| T021 | BLOCKED | 旧路径空间替换人工验收失败，不再补丁推进 |
| T022 | BLOCKED | fog-bounded coverage 等待稳定的新瓦片路线 |
| T023 | BLOCKED | TileEngineV2 生产路径人工验收失败 |
| T024 | DONE | 作为 V2 render transaction 证据保留 |
| T025 | DONE | 作为 V2 motion scheduling 证据保留，但人工体验仍失败 |
| T026 | BLOCKED | V2 预算补丁链冻结 |
| T027 | BLOCKED | V2 最终验收链冻结 |
| T028 | BACKLOG | 当前下一步：重置瓦片子系统并隔离旧上下文 |

## 默认读取策略

- 决策会话：读 `AGENTS.md`、本文件、`TASKS.md`、`KNOWLEDGE.md`、`docs/ai-session-log.md`、`docs/session-types.md`、`docs/architecture/index.md`、`docs/decisions/index.md`，再按主题读取必要分片。
- 实施会话：读 `AGENTS.md`、本文件、`TASKS.md` 当前任务行、当前任务文件、当前任务的 `Task Context Packet`、`KNOWLEDGE.md`、`docs/evidence/index.md`、`docs/ai-session-log.md`。
- 默认不得全文读取 `docs/knowledge/full.md`、`docs/evidence/` 全目录、大型 trace、截图、旧任务全集或旧瓦片实现源码。

## AI 执行硬约束

- 所有非 DONE 的实施任务必须有 `Task Context Packet`；缺失时停止实施，返回决策会话补齐。
- 实施会话只执行一个已批准 Task；不得顺手扩大范围。
- 修改 Forbidden Files、公共 API、核心架构、MVP、默认预算、依赖或验收门槛时，必须停止并返回决策会话。
- 瓦片重置任务不得从旧 `TileEngineV2`、旧 Display Coverage、旧 `TileMotionScheduler` 继续打补丁；这些内容只能作为明确允许的失败证据或接口边界读取。

## 关键索引

- 会话记录入口：`docs/ai-session-log.md`
- 知识入口：`KNOWLEDGE.md`
- Evidence 入口：`docs/evidence/index.md`
- 架构入口：`docs/architecture/index.md`
- 决策入口：`docs/decisions/index.md`
- 上下文包模板：`docs/task-context-packet-template.md`
- AI 治理知识：`docs/knowledge/ai-governance.md`
