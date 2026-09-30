# Git Commit Skill

## 目标

基于当前工作区的真实改动生成简洁中文 commit message；默认只生成，不提交、不推送。用户明确要求“直接推送”时，才提交并推送到远程。

## 流程

```text
读取 Git 状态
→ 读取工作区与暂存区 diff
→ 归纳改动性质
→ 生成中文 commit message
→ 默认只输出 message
→ 用户明确说“直接推送”时：暂存 → 提交 → 推送 → 报告结果
```

## 执行规则

1. 先执行 `git status`、`git diff`、`git diff --cached`，只依据真实 diff 归纳改动，不猜测改动内容。
2. commit message 使用中文，通常不超过 15 个字，格式为 `feat: 新增xxx`、`fix: 修复xxx`，其他类型可用 `docs:`、`refactor:`、`chore:`。
3. 默认模式：只输出生成的 commit message，不执行 `git add`、`git commit`、`git push`。
4. 直接推送模式（用户明确说“直接推送”）：生成 message 后暂存当前更改，执行 `git commit`，再推送到当前分支的远程；返回提交结果与推送结果。
5. 不修改本技能之外的任何文件，不修改 `git config`。
6. 无处可推、当前分支没有远程、推送被拒绝或提交被 hooks 拦截时，明确报错并停止，不擅自变通：不切换分支、不强制推送、不跳过 hooks、不额外补提交。
7. 暂存范围以实际改动为准，不夹带与当前改动无关的文件。

## 输出

- 默认模式：生成的 commit message（必要时附一行改动摘要）。
- 直接推送模式：
  - 生成的 commit message。
  - 提交结果（commit hash、分支）。
  - 推送结果（远程、分支）。
  - 失败时给出失败命令与原始错误，不做规避处理。