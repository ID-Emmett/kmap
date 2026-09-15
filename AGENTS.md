# Kmap AI Coding Rules

## 项目治理

本项目采用 Human-Governed + Spec-Driven + Task-Driven + Evidence-Driven AI Coding。人工负责人决定产品目标、范围、MVP、架构、数据结构、公共 API、技术选型、重大决策和最终验收。AI 编码会话负责研究、分析、实现、测试、调试、重构、性能分析和实施记录。

Kmap 只允许两种会话类型：

- 决策会话：负责产品目标、范围、MVP、架构、数据结构、公共 API、技术选型、任务拆分、任务排序、验收结论和阶段复盘。
- 实施会话：围绕一个已批准 Task 执行研究、实现、测试、调试、重构、性能分析、专项验证和记录。调试、验证、性能分析只是任务性质，不是独立会话身份。

核心架构、公共 API、项目范围或已确认技术方向发生变化时，必须先获得人工确认，并返回决策会话更新正式文件。

## 会话启动读取顺序

新会话必须通过仓库文件恢复状态。聊天记录只服务当前讨论；需要长期保留的人类可读会话摘要写入 `docs/ai-sessions/` 并由 `docs/ai-session-log.md` 建索引。`docs/project-state.md` 是低 token 当前状态入口；正式项目事实仍以 `PROJECT.md`、`TASKS.md`、`tasks/Txxx-*.md`、`KNOWLEDGE.md`、`docs/architecture/`、`docs/architecture.md`、`docs/decisions/`、`docs/decisions.md`、`docs/research/` 和 `docs/evidence/` 为准。

### 决策会话

决策会话必须依次读取：

1. `AGENTS.md`
2. `docs/project-state.md`
3. `PROJECT.md`
4. `TASKS.md`
5. `KNOWLEDGE.md`
6. `docs/ai-session-log.md`
7. `docs/session-types.md`
8. `docs/architecture/index.md`
9. `docs/decisions/index.md`
10. 与当前决策相关的 `docs/architecture/`、`docs/decisions/`、`docs/research/`、`docs/knowledge/` 分片、`docs/evidence/index.md` 或具体 evidence

### 实施会话

实施会话必须依次读取：

1. `AGENTS.md`
2. `docs/project-state.md`
3. `TASKS.md` 中当前任务行、依赖和执行顺序
4. 当前 `tasks/Txxx-*.md`
5. 当前任务的 `Task Context Packet`
6. `KNOWLEDGE.md`
7. `docs/evidence/index.md`
8. `docs/ai-session-log.md`
9. `Task Context Packet` 明确列入的 `PROJECT.md` 章节、架构分片、决策分片、知识分片、research、evidence 和源码文件

实施会话默认不得通读 `PROJECT.md` 全文、`docs/architecture.md` 全文、`docs/decisions.md` 全文、`docs/evidence/` 全量文件或无关历史任务。若旧任务没有 `Task Context Packet`，不得开始实施；只能返回决策会话补齐上下文包或显式批准临时上下文。

## Task Context Packet

所有新建或继续执行的实施任务必须包含 `Task Context Packet`。模板见 `docs/task-context-packet-template.md`。

`Task Context Packet` 必须定义：

- `Must Read`：执行前必须读取的最小文件。
- `Read If Needed`：只有出现对应问题或证据缺口时才读取的文件。
- `Allowed Files`：当前任务默认允许读取和修改的文件、目录或 glob。
- `Forbidden Files`：当前任务不得读取或修改的文件、目录或 glob；除非人工负责人明确解除限制。
- `Required Evidence`：必须产出的测试、截图、trace、JSON、人工验收或命令结果。
- `Stop Conditions`：触发停止实施并返回决策会话的条件。

Allowed/Forbidden Files 用于降低 token 消耗和上下文污染。实施会话不得用“顺手看看”“沿用旧思路”扩大文件范围；确需越界时，先说明原因并返回决策会话确认。

## Token 与门禁

- 默认以 `docs/project-state.md`、`docs/architecture/index.md`、`docs/decisions/index.md`、`KNOWLEDGE.md` 和 `docs/evidence/index.md` 作为索引入口，不因历史不确定而全文读取大文档。
- 读取详细文档前先用任务号、决策号、主题关键词或 evidence 文件名定位；只打开必要片段。
- 非 DONE 的实施任务缺少 `Task Context Packet` 时，不得执行源码修改。
- 实施结束前必须运行 `pnpm ai:check`；涉及源码时还必须按任务要求运行最近测试和 `pnpm check`。
- `pnpm ai:check` 只验证 AI 工程治理结构，不替代代码测试、浏览器矩阵或人工验收。

## 工作顺序

```text
Read
→ Analyze
→ Plan
→ Confirm when required
→ Implement
→ Test
→ Report
→ Record
```

每次实现只围绕一个明确 Task。任务开始时将状态更新为 `IN_PROGRESS`，进入验收时更新为 `VERIFYING`，满足验收标准后更新为 `DONE`。

## 修改规则

- 严格保持 Task 的 Scope、Non-Goals、Task Context Packet 和 Allowed/Forbidden Files。
- 修改前先理解现有代码、测试、架构约束和数据证据。
- 优先局部修改，不修改无关模块。
- 不擅自改变公共 API、核心架构、MVP 或技术基线。
- 新增依赖必须说明职责、替代方案和影响。
- 不删除、跳过或弱化测试来绕过失败。
- 不以猜测替代真实数据、代码或运行验证。
- 完成任务必须报告命令、结果、人工验证项和未解决问题。
- 正式规范文档只写当前有效状态、批准边界、执行规则、验收标准和证据索引；禁止讨论过程、阶段判断、废弃细节、对话解释和无证据推测。
- 讨论过程和废弃方案由 Git history 与 AI Session Log 保存。

## 代码规则

- 使用 TypeScript、严格类型检查和现代 ESM。
- 源代码文件以 500 行为上限目标；超过时必须拆分并说明原因。
- 模块保持单一职责，禁止万能 Manager。
- 代码注释、JSDoc、类型说明和开发期注解使用中文。
- 变量、函数、类和文件名使用英文工程命名。
- 注释只描述当前事实、职责和约束，不保留历史讨论。
- SDK 不依赖 Playground、Inspector、页面状态或业务 Demo 状态。
- Playground 通过 `@kmap/map3d` workspace 依赖 SDK。
- 自定义 Shader、材质节点和后处理统一使用 Three.js TSL / Node Material。
- Feature 不创建独立 Object3D；批处理边界由后续决策会话确认。

## 数据与证据

- `docs/research/` 是事实输入，必须区分“已验证”“代码已确认”“待验证”和“未发现”。
- research 之间存在冲突时保留冲突，不自行选择结论，交由决策会话处理。
- `KNOWLEDGE.md` 是已验证事实的轻量入口和索引；详细知识按主题分片到 `docs/knowledge/`。
- 知识按主题保存在 `docs/knowledge/`；归档内容通过 Git history 追溯。
- 已验证事实可写入对应 `docs/knowledge/` 分片，并同步 `KNOWLEDGE.md` 索引；推测、候选设计和未复现问题不得写成正式知识。
- `docs/evidence/index.md` 是 evidence 轻量入口；默认只读索引，按任务号、场景或文件名追溯具体 evidence。
- 新的非显然硬编码数据应记录来源和验证方法。

## AI 会话记录

- `docs/ai-session-log.md` 是人类可读的 AI 会话纪要入口和索引；详细记录按日期写入 `docs/ai-sessions/YYYY-MM-DD.md`。
- 决策会话必须读取 `docs/ai-session-log.md`；实施会话默认读取该入口文件，只有任务涉及人工验收失败、方向争议、架构重置、上下文污染风险或用户明确要求时，才读取相关日期详细记录。
- 所有项目内 AI 操作会话结束时都应追加一条会话记录，包括普通实施任务。用户自然语言输入优先保留原话；超长日志、代码、附件或敏感信息不得整段复制，应记录用途、文件路径、摘要或脱敏片段。
- 会话类型只能填写 `决策会话` 或 `实施会话`。任务性质、验证类型和性能分析范围写入关联范围或结论，不写成新的会话身份。

## 测试与完成标准

- 优先执行与修改范围最接近的测试，再执行 `pnpm check`。
- 文档/治理任务至少执行 `pnpm ai:check` 和 `git diff --check`。
- WebGPU/WebGL2、KYE 网络、浏览器交互和性能相关任务必须包含真实环境人工验证。
- 不得遗留类型错误、构建错误、失败测试或未说明的警告。
- 完成后更新当前 Task 的 Status、Findings、Open Issues，并同步 `PROJECT.md`、`TASKS.md`、`KNOWLEDGE.md`、`docs/knowledge/`、evidence 或 decisions 中实际受影响的部分。

## 会话边界

- 决策会话不承担日常功能实现；它产出任务、约束、取舍、验收结论和架构决策。
- 实施会话不擅自改变方向；它按单个 Task 和 Task Context Packet 执行，实现、验证和记录。
- 当实施发现任务边界错误、公共 API/架构需要变化、Allowed/Forbidden Files 不足、测试门槛需要调整或人工验收与自动证据冲突时，停止扩大实现，返回决策会话。
