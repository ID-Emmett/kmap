# T020 Fix Retained Tile Cache and Request Thrash

## Goal

修复 Ready Tile 离开当前 Target 后立即销毁以及 warm ancestor 周期性重新请求的问题，使 byte-aware LRU 成为真实的离屏 Ready Cache，并保证短距离往返 pan 可以直接复用 Fetch、Worker 和 GPU upload 结果。

## Scope

- 将 Target consumer、Display pin 和 Retained Cache 明确分离；Ready/empty/failed 记录在无 consumer 时按缓存策略保留，而不是立即 dispose。
- 保持 visible、coverage-critical 和 Display fallback 的 pin 语义；只有预算淘汰、source invalidation、明确失败策略或 Map3D dispose 才释放 retained Ready Tile。
- 修复 warm ancestor 在 ready、移出 desired、被销毁、再次请求之间的循环。
- Ready cache hit 重新进入 Target 时直接复用现有 generation、Worker payload 和 GPU resource。
- 校正 LRU 访问时间和淘汰顺序，继续同时遵守 entries、CPU bytes 和 GPU bytes 三项预算。
- 增加内部诊断和测试证据，区分首次请求、cache hit、预算 eviction、retry 和真正的 duplicate request。

## Non-Goals

- 不重写 T017 mixed-LOD selector 或 T018 motion prediction/priority。
- 不实现 parent/children 空间 cohort、Tile 淡入策略或 Render instance/material 重构；由 T021 负责。
- 不实现雾效加载边界；由 T022 负责。
- 不提高默认 256 entries、128 MiB CPU 或 256 MiB GPU 预算。
- 不新增 Service Worker、磁盘缓存、跨 Map3D 实例共享 Cache 或公开 Cache API。

## Inputs

- T008 Tile Runtime/Cache、T013 Display Coverage、T017 mixed LOD 和当前 T018 调度实现。
- `packages/map3d/src/runtime/tileRuntime.ts`、`displayCoverage.ts`、`tileRuntimeBudget.ts` 和现有 Cache 测试。
- `docs/research/tile-retention-display-fog.md`。
- `docs/research/tile-lod-scheduling.md` 中 MapLibre Tile Cache 与 deck.gl TileLayer 事实。

## Constraints

- Canonical TileKey、状态机、generation、Worker protocol 和 Map3D 0.1 公共 API 保持不变。
- Retained Ready Tile 必须计入现有 CPU/GPU/entry 预算，不允许以隐藏资源泄漏换取视觉稳定。
- visible 与 Display fallback 在正确替代覆盖建立前不得被 LRU 淘汰。
- 预算压力下优先抑制/淘汰 prefetch 和最旧 retained record，不得释放当前有效 Render Cover。
- idle、测试和浏览器证据必须能识别非 visible 请求抖动，不能只观察 visible Tile。

## Acceptance Criteria

- 固定 pitch 60 视图在稳定 30 秒后不再产生新的 Tile 请求；同一 canonical key 不发生无失败原因的周期性重新请求。
- A → B → A 往返 pan 在 A 未被预算淘汰时，A 的 Fetch、Worker build 和 GPU upload 次数均不增加。
- warm ancestor 完成后保持缓存或 Display pin，不出现 ready 后立即销毁并重新请求的循环。
- entries/CPU/GPU 任一超预算时按 LRU 淘汰最旧非 pinned record；visible/Display Cover 保持完整。
- retry、offline/recovery、204 empty、404 failed、stale completion 和 dispose 语义无回归。
- 针对性测试、`pnpm --filter @nova/map3d test` 与 `pnpm check` 通过。

## Test Plan

- Fake clock：Ready Tile 离开 Target、重新进入、预算淘汰、访问时间刷新和多预算竞争。
- Controlled adapters：记录每个 canonical key 的 Fetch/Worker/upload/dispose 次数，覆盖 A → B → A 与 warm ancestor。
- 浏览器：pitch 0/60、same-zoom pan、快速往返和静止 30 秒，保存 canonical request histogram。
- 网络：1500 ms 延迟、offline/recovery 和单节点失败，确认重复请求与正常 retry 可区分。
- 生命周期：三轮 create/dispose 后 retained records、资源、Worker 和事件全部归零。

## Status

DONE

## Findings

- 2026-09-10（修复前）：`TileRuntime.#applyDesiredConsumers()` 会立即释放无 active group、非 in-flight 且无 display consumer 的 terminal record，使 off-target Ready Tile 无法进入可复用 LRU。
- 2026-09-10（修复前）：Display Coverage 对 ready exact 预热 ancestor，但 ancestor ready 后不再进入 requested fallback；旧 Runtime 随即释放该 ancestor，下一次同步又重新请求，形成确定性循环。
- 2026-09-10（修复前）：ready cache hit 测试主要命中短暂 outgoing/display retention，没有覆盖真正离开 Target 和 Display Coverage 后的离屏复用。
- 2026-09-10：`TileRuntime` 现在保留无 Target consumer、无 Display pin 的 terminal record；Ready、empty 和 failed 分别作为预算内 retained entry 存在，只有预算淘汰、取消/重试策略或 Runtime dispose 才释放。
- 2026-09-10：Retained Ready/empty 再次进入 Target 或 Display 时复用同一 generation；受控 adapter 的 A → B → A 测试确认 Fetch、Worker、GPU upload 和 resource dispose 次数均不增加，并刷新 LRU access time。
- 2026-09-10：warm ancestor 完成后保持 retained；若被 entries/CPU/GPU 预算淘汰，会在当前 Coverage 内进入 prefetch suppression，避免 eviction 后立即重新派生请求。
- 2026-09-10：新增有界请求历史诊断，区分 initial、retry、eviction reload、cancellation reload 和无解释 duplicate request；Cache stats 同时报告 retained Ready/empty/failed、cache hit 和 budget eviction。
- 2026-09-10：`tileRuntimeCache.test.ts` 增加真实离屏 cache hit、LRU access 刷新、warm ancestor、预算抑制、empty/failed retention 和请求原因测试；`pnpm --filter @nova/map3d test` 通过 33 个文件、163 项测试，`pnpm check` 与 `git diff --check` 通过。
- 2026-09-10：Codex Chromium 1280×720、DPR 1.5 的 WebGPU/WebGL2 pitch 60 往返 pan 各记录 32 个 canonical request、32 个唯一 key、0 个重复 key；返回后静止 30 秒均无新请求。双后端 dispose 后 Tile、CPU/GPU、Object 和 Worker 归零，证据见 `docs/evidence/T020-browser-regression.json`。

## Open Issues

- 默认 Cache 预算保持不变；本次双后端往返场景 settled CPU/GPU 均为 103,635,528 bytes，未形成提高预算的证据。
- parent/children 空间 replacement cohort、same-zoom transition 和 Render instance/material 稳定性仍由 T021 负责；T020 未扩大该范围。
