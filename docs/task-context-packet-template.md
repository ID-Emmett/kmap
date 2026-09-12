# Task Context Packet Template

更新日期：2026-09-12

`Task Context Packet` 是每个实施任务的最小上下文包，用来降低 token、减少旧方案污染，并把 AI 会话限制在明确文件边界内。

将以下章节加入每个新建或重新执行的 `tasks/Txxx-*.md`。没有上下文包的旧任务，在实施前必须由决策会话补齐或显式批准临时上下文。

```md
## Task Context Packet

### Must Read

- `AGENTS.md`
- `PROJECT.md`（只读当前阶段、当前任务和相关约束）
- `TASKS.md`（只读当前任务行、依赖和执行顺序）
- `tasks/Txxx-*.md`
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`
- `docs/knowledge/<topic>.md`
- `docs/architecture.md`（列出必须章节）
- `docs/decisions.md`（列出必须决策）

### Read If Needed

- `docs/research/<topic>.md`：当 Must Read 无法判断事实来源时读取。
- `docs/evidence/Txxx-*.json`：当需要核对具体指标或时序时读取。
- `docs/knowledge/full.md`：仅当分片缺失或冲突时按关键词局部读取。

### Allowed Files

- `packages/...`：当前任务允许读取和修改的源码范围。
- `packages/.../test/...`：当前任务允许新增或修改的测试范围。
- `tasks/Txxx-*.md`
- `docs/evidence/Txxx-*`
- `docs/knowledge/<topic>.md`
- `PROJECT.md`
- `TASKS.md`

### Forbidden Files

- `packages/...`：不得读取或修改的旧方案、无关模块或公共 API。
- `docs/evidence/` 全量目录：不得整目录通读。
- `docs/knowledge/full.md`：不得默认通读。

### Required Evidence

- 自动测试命令和结果。
- 浏览器/性能/人工验收证据。
- 新增或更新的 evidence 文件。
- 必要的 before/after 指标。

### Stop Conditions

- 需要修改 Forbidden Files。
- 需要改变公共 API、核心架构、MVP、技术基线或验收门槛。
- 任务目标与人工验收反馈冲突。
- 自动证据不足以判断体验问题。
```

## 使用规则

- Must Read 是最小强制上下文，不是“读得越多越好”。
- Allowed Files 是默认工作边界；越界读取或修改必须有明确原因。
- Forbidden Files 是污染隔离墙；不得为了借鉴旧实现而默认打开。
- Evidence 先读索引，再按任务号和指标打开具体文件。
- 正式规范文档只写当前规则和证据索引；禁止讨论过程、阶段判断、废弃细节和推测。
