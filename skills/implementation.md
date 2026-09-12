# Implementation Skill

## 目标

围绕一个明确 Task 完成最小、可测试、可回溯的实现。

## 流程

```text
读取 Task
→ 读取上下文
→ 分析现有实现
→ 输出实施方案
→ 实现
→ 自动测试
→ 人工验证
→ 记录结果
```

## 执行规则

1. 将 Task 更新为 `IN_PROGRESS`，确认 Scope、Non-Goals、约束和验收标准。
2. 先寻找已有模块、测试和依赖边界，优先局部修改。
3. 公共 API、核心架构、MVP 或新增依赖超出已确认范围时暂停并请求确认。
4. 保持 SDK/Playground 边界、TypeScript strict、ESM、TSL 和 500 行目标。
5. 先运行定向测试，再运行 `pnpm check`。
6. 浏览器、GPU、网络或交互功能必须执行任务中声明的人工验证。
7. 记录 Findings、Open Issues 和实际测试结果，同步受影响的当前有效文档。

## 完成条件

- Acceptance Criteria 全部满足。
- 自动测试和构建通过。
- 人工验证完成或显式记录为阻塞。
- 没有无关修改、隐藏失败或未说明警告。
