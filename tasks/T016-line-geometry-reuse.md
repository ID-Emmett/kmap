# T016 Reuse Line Geometry for Repeated Style Passes

## Goal

降低 MVP 官方 Playground 在北京城市 zoom 场景的 Line TypedArray/GPU 资源占用，解除 T010 的 128 MiB CPU cache 初始预算阻断，同时保持当前浅色底图道路层级、公共 API、Tile lifecycle 和视觉连续体验不变。

## Scope

- 为同一 Tile 内 sourceLayer、zoom 可见性和 filters 相同、仅 paint color/opacity/width/renderOrder 不同的 Line 图层复用 Worker 生成的 line topology 与 GPU BufferGeometry。
- 首要覆盖官方 Playground 的 `road-casing`/`road-fill` 与 `major-road-casing`/`major-road-fill` 重复道路样式 pass。
- 保留每个 public line layer 的独立材质、线宽、opacity、renderOrder 和 draw pass，确保 casing 仍在 fill 下面渲染。
- 调整 Line Worker payload、render adapter、resource stats 和 transferable buffer 收集，使共享几何只计入一次 CPU/GPU byte estimate。
- 保持 Tile canonical/render key、Target/Display Coverage、display opacity、horizon fade、world-wrap render instance 和 dispose 所有权正确。
- 补充自动测试，覆盖共享/不共享 Line 图层、feature mapping、byte 统计、transferable、renderOrder、display opacity 和 dispose。
- 复跑 T010 相关浏览器性能与资源证据，重点验证北京 city z10 clean harness 低于 128 MiB CPU 预算。

## Non-Goals

- 不修改 `Map3D` 0.1 公共 API、Layer 配置格式、ViewState、TileKey、Worker protocol version 或 source 请求语义。
- 不降低 T010 资源门槛，不通过隐藏道路、降低 city zoom、减少 visible coverage 或提高默认 cache 预算来通过验收。
- 不改变 T012 已接受的 Playground 浅色视觉方向和道路层级。
- 不实现跨 Tile 合批、完整 Mapbox Style v8、dash/pattern/round join、文字、Picking 或新诊断面板。
- 不引入新的运行时依赖；如实现确需依赖，必须返回 Project Control 说明职责、替代方案和影响。

## Inputs

- T010 阻断证据：`docs/evidence/T010-view-matrix-harness.json`、`docs/evidence/T010-harness-webgpu-city-z10.png`、`docs/evidence/T010-harness-webgl2-city-z10.png`。
- T010 复算结论：city z10 48 个 visible tile 总资源 `171,828,744` bytes，其中 Line 为 `168,412,544` bytes；道路 casing/fill 重复是主因。只复用道路重复 pass 的近似目标为约 `89.1 MiB`。证据见 `docs/evidence/T016-line-resource-breakdown.json`。
- 现有实现：`packages/map3d/src/geometry/lineBatch.ts`、`packages/map3d/src/rendering/lineTile.ts`、`packages/map3d/src/rendering/tileRenderAdapter.ts`、`packages/map3d/src/worker/protocol.ts`。
- 视觉配置：`apps/playground/src/mapStyle.ts`。
- 架构与验收：`docs/architecture.md`、`docs/verification-baseline.md`、`docs/experience-baseline.md`、`docs/decisions.md` 的 D026。

## Constraints

- 共享 key 只能基于会产生完全相同 line topology 和 feature mapping 的字段：sourceLayer、filters、minZoom/maxZoom 可见性、canonical tile key、geometry type 和当前 line topology 规则；不得把 width/color/opacity/renderOrder 纳入 topology 共享 key。
- 同一个共享 geometry 可以被多个 render pass 使用，但每个 public layer 仍需要独立 material/width/renderOrder，避免破坏 casing/fill 视觉顺序。
- CPU/GPU byte 统计必须按实际持有的 TypedArray/BufferGeometry 资源计数，重复 draw pass 不得重复计算共享 buffer bytes；对象数和 batch/pass 数仍需可解释。
- Feature 不创建独立 Object3D；共享不得引入跨 Tile 合批。
- Display opacity、horizon fade 和 material dispose 必须对每个 display/render instance 生效；共享 geometry dispose 必须引用安全且幂等。
- Worker output transferable 列表不得重复转移同一个 ArrayBuffer。
- 源文件继续以 500 行为上限目标；超出时拆分并说明。

## Acceptance Criteria

- `road-casing`/`road-fill` 和 `major-road-casing`/`major-road-fill` 在同一 Tile 内复用 Line geometry，渲染顺序、颜色、宽度和 opacity 与 T012/T015 基线一致。
- 不满足共享条件的 Line 图层不会错误共享，例如不同 sourceLayer、不同 filters、不同 zoom 可见性或不同 topology 规则。
- T010 city z10 clean harness 在 WebGPU 与强制 WebGL2 下 CPU resource 低于 `134,217,728` bytes，GPU resource 仍低于 256 MiB。
- WebGPU/WebGL2 的 low/city/high/pitch60 frame P95、worker total P95、upload P95 继续满足 T010 门槛。
- 1500 ms 延迟下 zoom/pan 无背景空洞、硬切或 stale 层级回挂；T014 阻尼与 T015 远景渐隐无回归。
- 三次 create/dispose 后 Tile、resource、worker、materials 和 shared geometry 引用全部归零。
- `pnpm check` 通过。
- 完成后更新 T016 Findings/Open Issues，并同步 T010、PROJECT、TASKS、KNOWLEDGE 或 architecture 中实际受影响部分；T010 只有复验通过后才能从 BLOCKED 进入 VERIFYING/DONE。

## Test Plan

- 新增或更新 SDK unit/integration 测试：
  - Line topology sharing key：相同 sourceLayer/filter 的 casing/fill 共享，差异配置不共享。
  - Worker payload 与 transferable：共享 buffer 不重复列入 transferables，feature ranges/featureIds 可追溯。
  - Render adapter：同一 shared geometry 支持多个 material/renderOrder/width pass、display opacity、world wrap 和 horizon fade。
  - Resource stats：共享 bytes 只计一次，objects/pass 数保持可解释，dispose 后归零。
- 执行 `pnpm --filter @nova/map3d test`、`pnpm --filter @nova/map3d typecheck`、`pnpm check`。
- 复跑 T010 clean harness：WebGPU/WebGL2 的 low/city/high/pitch60，保存 JSON 和截图。
- 复跑 T010 60 秒交互、生命周期 dispose、连续加载、自动 fallback 和网络异常矩阵。

## Status

DONE

## Findings

2026-09-10 Project Control 确认优先新建 T016，通过 Line casing/fill 几何复用处理 T010 资源预算阻断，不修改 T010 初始 128 MiB CPU cache 门槛。

2026-09-10 开始 T016 Implementation，会话按任务 Scope 先实现同 Tile 内重复 Line 样式 pass 的 geometry/topology 共享，再复核自动测试和 T010 资源证据。

2026-09-10 已完成实现：Line batch 使用只包含 sourceLayer、filters、zoom 可见性、canonical Tile 和 topology 版本的 `geometryKey`；相同 key 的 pass 复用 Worker TypedArray，主线程按 key 复用 BufferGeometry，材质、线宽、opacity、renderOrder 和 draw pass 仍按 public layer 独立保留。共享 feature mapping、stats 去重、transferable 去重和幂等 geometry dispose 已覆盖。

2026-09-10 自动验证：共享边界的 4 个测试文件、20 项测试通过；最终仓库级 `pnpm check` 通过，包含 `@nova/map3d` typecheck、SDK/Worker build、31 个 SDK 测试文件 129 项测试、Playground 2 个测试文件 4 项测试和 production build；`git diff --check` 通过。

2026-09-10 资源复算：按 T010 北京 city z10、1920x1080、DPR 1、48 visible tiles 重新请求并执行当前 `buildTilePayload()`，共享后 output/resource bytes 为 `89,149,680` bytes（约 85.0 MiB），低于 CPU `134,217,728` bytes 和 GPU `268,435,456` bytes 门槛；共 131 个唯一 Line geometry、227 个 Line render pass，其中 96 个 pass 共享，正好覆盖 `road-casing`/`road-fill` 48 组和 `major-road-casing`/`major-road-fill` 48 组。证据见 `docs/evidence/T016-city-z10-resource-check.json`。

2026-09-10 真实浏览器复验完成：Chrome 151、Windows 11、1920x1080、DPR 1 下，WebGPU/WebGL2 的 city z10 最大 CPU resource 分别为 `134,170,325` 和 `134,195,458` bytes，均低于未修改的 128 MiB 上限，但余量仅 `47,403` 和 `22,270` bytes，必须视为贴近预算而非宽裕。对应 GPU 最大值为 `132,527,696` 和 `132,259,356` bytes，低于 256 MiB 上限；city z10 frame P95 分别为 4.6/4.5 ms，pitch60 为 8.4/8.0 ms，均满足 T010 门槛。证据见 `docs/evidence/T016-browser-regression.json` 和 `docs/evidence/T016-*-city-z10.png`。

2026-09-10 Worker/upload 复验：固定 Tile 40 次样本的 worker total P95 为 8.6 ms、build P95 为 4.7 ms、upload P95 为 1.9 ms；单 Tile output bytes 从 T010 的 `497,592` 降至 `295,064`，减少约 40.7%。证据见 `docs/evidence/T016-worker-upload-performance.json`。

2026-09-10 回归矩阵通过：双后端 60 秒交互的最大 CPU/GPU 均未超过预算，1500 ms 延迟 zoom/pointer pan 无矩形背景空洞、硬切或 stale 层级回挂；三轮 create/dispose 后 Tile、resource 和 worker 统计归零；无 WebGPU 自动 fallback、单节点失败、全部节点失败和离线恢复均符合既有基线。WebGPU/WebGL2 截图中道路 casing/fill 顺序、颜色、宽度和 opacity 与 T012/T015 基线一致，无规则网格、Tile 接缝或连续加载空洞。证据见 `docs/evidence/T016-browser-regression.json` 及对应截图。

2026-09-10 T016 验收完成。实现未修改公共 API、Worker protocol version、cache 门槛、Coverage 或核心架构；T010 的 city z10 资源发布阻断已解除。后续 T010 已完成 long task trace 和最终发布判断。

## Open Issues

- T016 范围内无未解决问题。
- T010 后续已完成 60 秒交互 long task trace；该风险不阻断 T016 的几何复用验收。
