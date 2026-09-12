# T006 Render Fixed KYE Polygon Vertical Slice

## Goal

完成首条真实纵向链路：固定 KYE Tile → Fetch → MVT → Worker Polygon Batch → Three.js → WebGPU/WebGL2 显示，并验证 Tile 级 GPU 资源销毁。

## Scope

- Polygon batch payload 到 Three.js BufferGeometry/Material/Mesh。
- Tile container、Tile anchor、MapOrigin 相对位置和 layer render order。
- MaterialRegistry 引用计数和 Tile GPU record。
- Playground 固定 ViewState/固定 Tile 的真实 KYE 演示配置。
- WebGPU 默认路径和 `?renderer=webgl2` 强制路径。
- 最小统计：backend、Tile state、batch、feature、vertex、index、CPU/GPU bytes。
- eviction/dispose 的 detach 与资源释放验证。

## Non-Goals

- 不实现动态可见 Tile、Camera 手势、Line、缓存 LRU、重试调度或公共 setView。
- 不实现文字、3D extrusion、Picking、完整 Style v8 或业务 Overlay。
- 不暴露 Scene/Camera 作为新的稳定公共 API。

## Inputs

- T003、T004、T005 输出。
- `docs/architecture.md` 的 Render、GPU ownership 和公共 API 约束。
- `docs/verification-baseline.md` 的固定高 zoom KYE 场景。
- research 样本 `z15/26978/12416` 或经证据记录的等价 Polygon Tile。

## Constraints

- Feature 不创建独立 Object3D。
- Tile dispose 必须幂等；共享 Material 只有引用归零后才能 dispose。
- Inspector 仍只由 Playground 挂载，SDK 不依赖 Inspector。
- 不为通过演示而硬编码未记录来源的数据。

## Acceptance Criteria

- 真实 KYE Polygon 在 WebGPU 和强制 WebGL2 中可见，坐标方向和 Tile 边界正确。
- 一个 Layer batch 对应有限对象，不随 Feature 数量创建对象。
- stats 与 fixture feature/vertex/index 数可解释。
- Tile 移除和 Map3D dispose 后 registry 计数归零，无继续运行的 job/loop。
- 失败通过结构化错误呈现，Playground 不吞掉错误。

## Test Plan

- BufferGeometry attributes/index/material ownership 单元测试。
- MaterialRegistry 引用计数和重复 dispose。
- `pnpm check`。
- 真实 Chromium 人工验证 WebGPU 和 `?renderer=webgl2`，记录后端、截图、控制台和资源统计。

## Status

DONE

## Findings

- 已实现 `PolygonTileGpuRecord`：每个 Polygon layer batch 创建一个 `BufferGeometry`/`Mesh`，Tile 使用单个 `Group`，不创建 Feature 级 Object3D；`position`、`featureId`、Uint32 index、feature range 和 tile-local feature table 均保留。
- 已实现 `MaterialRegistry`：相同 material key 共享 `MeshBasicNodeMaterial`，按 batch 引用计数，引用归零后只 dispose 一次；Tile detach、Geometry dispose 和重复 dispose 已由测试覆盖。
- 已实现固定 Tile Controller：真实请求经 Fetch → Worker Pool → GPU record，支持 HTTP 204 empty、generation、Abort、Worker cancel、unload 和 dispose；fetch/build 中途释放均拒绝迟到结果并保持资源归零。
- 已接入 `Map3D` 与 Playground：固定 ViewState 对应已验证 fixture `z15/26978/12416`，WebGPU 默认、`?renderer=webgl2` 强制回退，错误输出包含 `code/phase/recoverable/tileKey`，页面通过 `data-nova-status` 暴露验收状态。
- 固定 fixture 三个 Polygon batch 的确定统计为：276 features、2,139 vertices、4,755 indices、53,244 CPU bytes、53,244 GPU estimate bytes、4 个 Tile/Batch 对象。
- 2026-09-09 在当前 Windows Codex Chromium、1280×720 CSS viewport、DPR 1.5 实测 WebGPU 与强制 WebGL2 均正确显示 water/landuse/building，北向位于屏幕上方；控制台仅有 Vite debug 和 Nova ready info。截图：`docs/evidence/T006-webgpu-2026-09-09.png`、`docs/evidence/T006-webgl2-2026-09-09.png`。
- `?lifecycle=dispose` 与 `?renderer=webgl2&lifecycle=dispose` 实测 Tile、batch、feature、vertex、index、CPU/GPU byte、对象和 Worker active/queued 全部归零。Playground 在 dispose 前等待 Inspector timestamp query 完成，避免销毁查询池时产生开发期控制台错误。
- 自动验证：`pnpm --filter @nova/map3d test` 为 15 个测试文件、55 个测试通过；`pnpm check` 全部通过。SDK bundle 继续 externalize `three/webgpu`，`dist/index.js` 29.27 kB（gzip 9.44 kB）；独立 Worker bundle 35.64 kB（gzip 10.86 kB），不包含 Three.js。

## Open Issues

- 当前浏览器控制接口未暴露可记录的 GPU/driver 标识；跨 GPU/driver、无 WebGPU 自动 fallback 和 steady-state 性能仍由 T010 在指定目标工作站完成。
- 本任务记录的 frame stats 包含初始化、网络和 Inspector 开销，不作为 D020 性能门槛结论。
