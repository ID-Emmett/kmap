# T021 Implement Spatial Best-Available Tile Replacement

## Goal

将 Display Coverage 从全局 Target signature 驱动的淡入淡出改为按空间区域保证的 best-available replacement，使 pan、zoom 和 mixed-LOD refinement 在慢网下始终具有连续 Render Cover，并消除反复淡入、露底和 Render instance/material 抖动。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md`（只读 T021、T023、T028）
- `tasks/T021-spatial-tile-replacement.md`
- `KNOWLEDGE.md`
- `docs/knowledge/tile-runtime.md`
- `docs/architecture/index.md`
- `docs/architecture/tile-system.md`
- `docs/decisions/index.md`
- `docs/decisions/D031-tile-system-reset-and-ai-context-isolation.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`

### Read If Needed

- `docs/ai-sessions/2026-09-12.md`：需要追溯人工验收失败原话和路线变更时读取。
- `docs/evidence/T021-browser-regression.json`：只在复盘自动证据与人工结论冲突时读取。
- `tasks/T023-tile-engine-v2.md`：只在说明 T021 被 V2 迁移吸收且仍失败时读取。

### Allowed Files

- `tasks/T021-spatial-tile-replacement.md`
- `TASKS.md`
- `PROJECT.md`
- `docs/project-state.md`
- `docs/knowledge/tile-runtime.md`
- `docs/ai-session-log.md`
- `docs/ai-sessions/YYYY-MM-DD.md`

### Forbidden Files

- `packages/map3d/src/runtime/displayCoverage*.ts`
- `packages/map3d/src/runtime/tileRuntimeDisplay.ts`
- `packages/map3d/src/runtime/tileRuntime.ts`
- `packages/map3d/src/runtime/tileEngineV2*.ts`
- `packages/map3d/src/rendering/**`
- `docs/evidence/` 全量目录
- `docs/knowledge/full.md` 默认全文

### Required Evidence

- 当前 BLOCKED 状态下仅允许治理检查：`pnpm ai:check` 与 `git diff --check`。
- 若要重新打开本任务，必须由决策会话重写上下文包并说明为何不走 T028。

### Stop Conditions

- 需要继续修改旧 Display Coverage 或旧 Tile Runtime。
- 需要以 T021 自动证据覆盖人工验收失败。
- 需要恢复 T026/T027 补丁路线。

## Scope

- 为 Target Tile、ready ancestor/descendants 和 outgoing Tile 建立明确的空间覆盖关系。
- parent 只有在对应区域所需 children 全部 ready 并可同帧提交时才退出；children 作为 replacement cohort 提交。
- 连续 Target 更新不得全局清空 outgoing；每个空间区域独立决定保留、替换和过渡完成。
- 同 zoom pan 和 retained cache hit 直接以完整 opacity 显示，不重新执行 Tile 淡入。
- 将短过渡限制为真正的 LOD parent/child replacement，并保证进度单调、不会因新 Target signature 重启。
- 稳定复用 Tile Render instance 和显示材质；避免 render key 暂时移除时反复 clone/dispose，以及 opacity 跨 1 时反复触发材质管线更新。

## Non-Goals

- 不改变 T017 selector 的 SSE、LOD 邻接和 Tile 数量预算。
- 不修改 T018 motion prediction、请求取消迟滞或队列优先级。
- 不实现 T022 fogStart/fogEnd/loadCutoff。
- 不新增完整 MapLibre、deck.gl Runtime 或公开 transition API。
- 不通过延长无限 outgoing retention 或提高 Cache 预算掩盖替换错误。

## Inputs

- T013 Target/Display Coverage、T017 mixed LOD、T020 retained cache。
- `packages/map3d/src/runtime/displayCoverage.ts`、`displayCoverageSpatial.ts`、`tileRuntimeDisplay.ts`。
- `packages/map3d/src/rendering/tileRenderAdapter.ts` 和 MaterialRegistry。
- deck.gl best-available refinement 与 MapLibre parent/child retain 研究结论。

## Constraints

- Render Cover 必须覆盖当前有效 Target 区域；任何 parent 退出都要有空间等价的 ready replacement。
- 不允许同一空间区域长期显示多层不受控叠加；正常上限仍为 exact 与一个 fallback/outgoing 层级。
- failed exact 必须保留可用 fallback 并报告错误，不能触发空白。
- WebGPU 与 WebGL2 使用同一 TSL/Node Material 行为，不新增独立 Shader。
- Render resource 稳定化必须维持确定性 dispose 和现有 CPU/GPU byte 统计。

## Acceptance Criteria

- 1500 ms 延迟下连续 same-zoom pan、zoom、bearing/pitch 不出现背景空洞、整块闪烁、旧层级回挂或全局淡入重启。
- parent 仅在覆盖其空间的全部 replacement children ready 后退出；部分 child ready 不得提前淡出 parent。
- retained cache hit 和已经显示的 exact Tile 不重新淡入；opacity 过渡只发生于明确的 LOD replacement。
- 快速连续 Target 更新中，每个 replacement cohort 的过渡进度单调，不因无关 Tile 到达而归零。
- Render instance/material 创建、销毁和 pipeline 更新不随每帧 render key 抖动；before/after 计数具有可解释改善。
- WebGPU、强制 WebGL2、reduced-motion、失败 fallback 和 dispose 浏览器回归通过。
- 针对性测试、`pnpm --filter @nova/map3d test` 与 `pnpm check` 通过，人工负责人接受 pan/zoom 加载观感。

## Test Plan

- 纯空间测试：parent/children 完整覆盖、部分 ready、mixed zoom 邻接和 world wrap。
- Fake clock：多次 Target signature 变化、cohort 提交、过渡单调和 reduced-motion。
- Controlled Render adapter：记录 instance/material create/dispose 和 opacity/pipeline 状态变化。
- 浏览器慢网：1500 ms 下 same-zoom pan、rapid return、连续 zoom、rotate 和 pitch 60。
- 截图或逐帧像素/coverage 证据：证明 replacement 期间 fogEnd 前没有背景露出。

## Status

BLOCKED

## Findings

- 2026-09-10：当前 Target signature 改变时会整体清理既有 outgoing；只要新计划存在任意 exact，所有 outgoing 都可开始淡出，缺少按 parent/children 空间范围判断 replacement 完整性的约束。
- 2026-09-10：当前 outgoing overlap 仅按相同 recordId 删除，不能证明不同 zoom 的 replacement 已完整覆盖相同空间。
- 2026-09-10：当前 render key 移除会销毁克隆材质和实例，重新进入时再次创建；display opacity 跨 1 会切换 transparent 并设置 needsUpdate。
- 2026-09-11：`DisplayCoverageCoordinator` 已改为按空间 overlap 保留 outgoing，parent/fallback 仅在当前有效 Target 区域存在 ready replacement cohort 后退出；same-zoom ready/cache hit 直接以 opacity 1 显示，短过渡只在 LOD parent/child 替换时启动。
- 2026-09-11：新增 `displayCoverageReplacement.ts` 承载 replacement 完整性、overlap 和 LOD 替换判断；快速无关 Target 更新不会重置已有 replacement cohort 的 `transitionStartedAt`。
- 2026-09-11：`ThreeTileRenderAdapter` 在 render key 暂时移除时 detach 实例但不 dispose 克隆 display material；render key 恢复时复用原 `Group`/`Mesh`/material，opacity 首次低于 1 后保持 `transparent=true`，避免跨 1 反复触发 pipeline update。
- 2026-09-11：自动验证通过：`pnpm --filter @nova/map3d typecheck`、`pnpm --filter @nova/map3d test`（33 个测试文件、169 项测试）、`pnpm check` 和 `git diff --check`。
- 2026-09-11：真实浏览器回归通过：Codex Chromium 1280×720、DPR 1.5 下，WebGPU 与强制 WebGL2 在 1500 ms 延迟的 same-zoom pan、rapid return、rapid zoom、bearing 35/pitch 60 和 dispose 场景控制台 warning/error 为 0；reduced-motion 与离线失败 fallback/恢复场景通过。证据见 `docs/evidence/T021-browser-regression.json` 和 `docs/evidence/T021-*.png`。
- 2026-09-11：人工负责人验收不通过：实际 pan/zoom 仍明显延迟，停止交互后才看到 Tile 出现，缺少预加载的连续感，Tile 逐块补齐且仍有白闪；自动脚本/截图不能替代该阻断观感结论。
- 2026-09-11：决策会话根据上述结果确认问题跨越旧 Runtime 的调度、Target/Display 提交、缓存保留和资源复用边界；D030/T023 改为建立独立 `TileEngineV2`，不继续在本任务代码上叠加补丁。

## Open Issues

- 人工 pan/zoom 观感已明确不接受，T021 保持 `BLOCKED`，不能标记为 `DONE`。
- T021 只保留为失败证据和旧路径隔离输入；后续必须先执行 T028，不得继续在本任务代码上补丁推进。
