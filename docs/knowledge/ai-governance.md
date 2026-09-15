# Kmap Knowledge — AI Governance

更新日期：2026-09-12

## 当前治理模型

- Kmap 采用 Human-Governed + Spec-Driven + Task-Driven + Evidence-Driven AI Coding。
- 会话类型只允许 `决策会话` 和 `实施会话`；调试、验证、性能分析和迁移只是任务性质。
- `docs/project-state.md` 是低 token 当前状态入口；正式事实仍由 `PROJECT.md`、`TASKS.md`、任务文件、decisions、knowledge 和 evidence 共同承载。

## 上下文控制

- 所有非 DONE 的实施任务必须包含 `Task Context Packet`。
- `Task Context Packet` 用 `Must Read`、`Read If Needed`、`Allowed Files`、`Forbidden Files`、`Required Evidence` 和 `Stop Conditions` 控制读取、修改和验收边界。
- 默认不得通读 `docs/evidence/` 全目录、旧任务全集或与当前任务无关的历史会话记录。

## 文档污染控制

- 正式规范文档只写当前有效状态、批准边界、执行规则、验收标准和证据索引；禁止讨论过程、阶段判断、废弃细节、对话解释和无证据推测。

## 会话记录

- `docs/ai-session-log.md` 是轻量入口和索引。
- 详细会话记录按日期写入 `docs/ai-sessions/YYYY-MM-DD.md`。
- 用户自然语言输入优先保留原话；超长日志、代码、附件或敏感内容只记录用途、路径、摘要或脱敏片段。

## 自动门禁

- `pnpm ai:check` 用于检查低 token 入口、任务上下文包、状态一致性、索引文件和会话记录是否满足治理要求。
- 该检查不能代替代码测试、浏览器验证或人工验收；它只验证 AI 工程治理结构是否保持可执行。
