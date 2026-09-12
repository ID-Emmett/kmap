# T024 TileEngineV2 Render Transaction and Stable Cover

## Goal

建立真实的 Render transaction，使 Tile upload 不再逐个改变画面；在 exact Tile 未齐时始终保留空间连续的 coarse/ancestor cover，避免初始加载、pan/zoom replacement 的白闪和水波式逐块出现。

## Scope

- 为每个 Target token 建立 pending upload cohort，ready resource 先进入 pending，不立即修改 Render Cover。
- 在一个 rAF/等价帧边界一次提交空间完整的 replacement cohort；部分 child 到达不得退出 parent。
- 初始视图先建立可覆盖有效区域的 coarse/ancestor Render Cover，再渐进提升 exact；没有 active display 时也必须生成必要 fallback 请求。
- parent 与 child 的替换采用原子硬切换或 group-level transition；同一区域不得出现无控制的透明 parent/child 叠加。
- 保持 Render instance、material、GPU resource 复用和确定性 dispose；不改变 Three.js、Worker protocol 或 Map3D 公共 API。

## Non-Goals

- 不修改 Tile Coverage selector 的 LOD 算法、运动预测或请求公平性（T025）。
- 不修改 visible/prefetch 预算模型（T026）。
- 不实现 fogStart/fogEnd/loadCutoff（T022）。
- 不通过延长 outgoing retention、提高默认并发或预算掩盖提交错误。

## Acceptance Criteria

- controlled adapter 能证明多个异步 upload 在同一提交边界一次更新 Render Cover，单 Tile 完成不会单独改变显示集合。
- 初始加载在 exact 未齐时存在完整 coarse/ancestor cover；无背景空洞、白闪或中心向外的逐 Tile 露底。
- parent 只有在空间等价 replacement cohort 全部 ready 且可同帧提交后退出；部分 child ready 保持 parent。
- same-zoom/cache-hit 直接显示；LOD replacement 的过渡单调，且同一区域不发生失控透明叠加。
- WebGPU/WebGL2、1500 ms 延迟、reduced-motion、失败 fallback、dispose 测试通过。

## Test Plan

- Fake clock/controlled source、worker、render：上传完成顺序随机化、部分 cohort、stale token、初始 fallback 和提交计数。
- ThreeTileRenderAdapter：render key、instance/material、opacity、pipeline update 和 dispose 计数。
- 真实 Chromium：WebGPU 与强制 WebGL2 的冷启动、same-zoom pan、连续 zoom、rapid return，记录逐帧 Render Cover 与背景像素。

## Status

DONE

## Findings

- 2026-09-12：已为 `TileEngineV2` 增加 rAF Render transaction gate。Worker/Render upload 完成后的 resource 先以空 render key 保留在 pending eligibility 中，直到同一 `requestAnimationFrame` 边界一次开放给 Display Coordinator；Node fake clock 下使用 microtask 等价边界，便于纯测试确定性验证。
- 2026-09-12：`TileEngineV2DisplayCoordinator` 现在在初始无 active/outgoing 显示时也派生 required parent fallback 请求；当下一帧 selection 无法完整覆盖当前 visible Target 时拒绝提交，避免部分 exact Tile 独自改变 Render Cover。
- 2026-09-12：parent/child replacement 改为先判断 ready ancestor 下的全部 target child 是否具备 ready replacement cohort；不完整时继续显示 parent/fallback，完整后再启动受控 LOD transition，same-zoom/cache-hit 仍直接显示。
- 2026-09-12：GPU upload 调用改为先传入空 `renderKeys`，避免 upload 完成瞬间被 Three.js adapter 挂载到 Scene；`getStats().idle` 在 rAF commit 尚未 flush 时保持 `false`，防止 pending display commit 被误判为 idle。
- 2026-09-12：新增/更新自动测试覆盖多 upload 同帧提交、单 Tile upload 不改变不完整 Render Cover、初始 parent fallback 请求与 coarse cover、真实 rAF flush 前不挂载资源且非 idle、初始 parent 不叠加部分 ready child、以及旧 TileRuntime 兼容测试的 fallback 边界。
- 2026-09-12：验证命令通过：`pnpm --filter @nova/map3d typecheck`；`pnpm --filter @nova/map3d test -- tileEngineV2.test.ts displayCoverage.test.ts tileRuntime.test.ts tileRuntimeProgressive.test.ts`（4 个文件、39 项）；`pnpm --filter @nova/map3d test`（34 个文件、176 项）；`pnpm check`。
- 2026-09-12：真实 Chrome 152 headless browser 回归通过，证据为 `docs/evidence/T024-browser-regression.json` 与 `docs/evidence/T024-*.png`。WebGPU、强制 WebGL2 和 reduced-motion 的 1500 ms pan 场景 console issue 为 0、dispose 后 Tile/resource/worker 归零、pan settled 请求无重复 canonical；WebGPU offline fallback/recovery 场景也完成恢复与 dispose 归零。

## Open Issues

- T024 scope 内无未解决问题；rAF 提交边界已采用，LOD replacement 保留既有受控 transition 且满足空间原子性。
- T025 已完成运动中 refinement 调度与公平队列；T026/T027 仍需继续解决 prefetch 预算分离和最终人工 pan/zoom 观感验收。
