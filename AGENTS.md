# Nova AI Coding Rules

## 项目治理

本项目采用 Human-Governed + Spec-Driven + Task-Driven + Evidence-Driven AI Coding。人工负责人决定产品目标、范围、MVP、架构、数据结构、公共 API、技术选型、重大决策和最终验收。AI Agent 负责研究、分析、实现、测试、调试、重构、性能分析和实施记录。

核心架构、公共 API、项目范围或已确认技术方向发生变化时，必须先获得人工确认。

## 会话启动读取顺序

普通实施会话必须依次读取：

1. `AGENTS.md`
2. `PROJECT.md`
3. `TASKS.md`
4. 当前 `tasks/Txxx-*.md`
5. 与任务相关的 `docs/architecture.md`、`docs/decisions.md`、`KNOWLEDGE.md` 和 research

Project Control 会话必须读取：

1. `AGENTS.md`
2. `PROJECT.md`
3. `TASKS.md`
4. `KNOWLEDGE.md`
5. `docs/architecture.md`
6. `docs/decisions.md`
7. 与当前决策相关的 `docs/research/`

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

- 严格保持 Task 的 Scope 和 Non-Goals。
- 修改前先理解现有代码、测试、架构约束和数据证据。
- 优先局部修改，不修改无关模块。
- 不擅自改变公共 API、核心架构、MVP 或技术基线。
- 新增依赖必须说明职责、替代方案和影响。
- 不删除、跳过或弱化测试来绕过失败。
- 不以猜测替代真实数据、代码或运行验证。
- 完成任务必须报告命令、结果、人工验证项和未解决问题。
- 文档只保留当前有效状态；讨论过程和废弃方案由 Git history 保存。

## 代码规则

- 使用 TypeScript、严格类型检查和现代 ESM。
- 源代码文件以 500 行为上限目标；超过时必须拆分并说明原因。
- 模块保持单一职责，禁止万能 Manager。
- 代码注释、JSDoc、类型说明和开发期注解使用中文。
- 变量、函数、类和文件名使用英文工程命名。
- 注释只描述当前事实、职责和约束，不保留历史讨论。
- SDK 不依赖 Playground、Inspector、页面状态或业务 Demo 状态。
- Playground 通过 `@nova/map3d` workspace 依赖 SDK。
- 自定义 Shader、材质节点和后处理统一使用 Three.js TSL / Node Material。
- Feature 不创建独立 Object3D；批处理边界由后续 Project Control 任务确认。

## 数据与证据

- `docs/research/` 是会话 A 的事实输入，必须区分“已验证”“代码已确认”“待验证”和“未发现”。
- research 之间存在冲突时保留冲突，不自行选择结论，交由 Project Control 处理。
- 已验证事实可写入 `KNOWLEDGE.md`；推测、候选设计和未复现问题不得写成正式知识。
- 新的非显然硬编码数据应记录来源和验证方法。

## 测试与完成标准

- 优先执行与修改范围最接近的测试，再执行 `pnpm check`。
- WebGPU/WebGL2、KYE 网络、浏览器交互和性能相关任务必须包含真实环境人工验证。
- 不得遗留类型错误、构建错误、失败测试或未说明的警告。
- 完成后更新当前 Task 的 Status、Findings、Open Issues，并同步 `PROJECT.md`、`TASKS.md`、`KNOWLEDGE.md` 或 decisions 中实际受影响的部分。

## 会话职责

- Project Control：规划、MVP、架构、数据结构、公共 API、技术决策、任务拆分和阶段复盘，不承担日常功能实现。
- Implementation：围绕单个 Task 完成 Read Context → Plan → Implement → Test → Report。
- Review / Performance：负责审查、回归、性能基线、指标采集和专项验证。

Spend time on thinking; you do not need to use the commentary channel to report progress to me.

新会话必须通过仓库文件恢复状态。聊天记录只服务当前讨论，不作为长期项目事实源。
