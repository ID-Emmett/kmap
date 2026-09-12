# T005 Implement Worker Polygon Batch Pipeline

## Goal

实现版本化 Worker 协议和 Polygon 批次构建，把 MVT 解码、过滤、投影与三角化从主线程移出，并输出可直接上传的 Tile 局部 TypedArray。

## Scope

- `protocolVersion: 1` 的 build/cancel/success/error 消息。
- Worker Pool、jobId、generation、transferable 输入输出和单 Worker 测试注入。
- MVP Layer filter：`==`、`!=`、`in`、`!in`、`has`。
- MVT Polygon ring 分类、outer/hole 组织和 `earcut` 三角化。
- Tile × layer × material key 的 Polygon batch payload。
- Float32 positions、Uint32 indices、featureIds/feature range 和 byte 统计。
- 评估并安装批准的 `earcut` 依赖。

## Non-Goals

- 不创建 Three.js Mesh/Material/BufferGeometry。
- 不实现 Line batch、Camera、Tile Scheduler、GPU Cache 或 Picking API。
- 不做跨 Tile 合批、全局裁剪或建筑 extrusion。
- 不在 Worker 中 fetch、访问 DOM、Canvas 或 Renderer。

## Inputs

- T003、T004 输出。
- `docs/architecture.md` 的 Worker、Geometry、Batch 和 Feature 映射。
- `docs/decisions.md` D016、D017、D021。
- `docs/verification-baseline.md` 的 Worker/fixture 验证要求。

## Constraints

- Transfer 后原 buffer 所有者不得继续访问。
- stale generation 或 disposed consumer 不得挂载 Worker 结果。
- Geometry 模块保持渲染后端无关；不得导入 Three.js renderer。
- 每个 Feature 不创建独立对象或独立材质描述。

## Acceptance Criteria

- Polygon hole 不被填充，index 不越界且无明显退化三角形。
- 同一 layer/material 的 Feature 合入有限批次并保留可追溯 feature id。
- build/cancel/error/version mismatch 都有确定消息语义。
- 输入和主要输出 buffer 使用 transferable，统计包含 decode/build/bytes。
- Worker bundle 能由 Vite 构建，Node 测试可用受控 adapter 验证协议。

## Test Plan

- 真实 KYE fixture 的多 ring Polygon、空 layer 和属性过滤。
- 合成 hole/多个 outer ring、无效 ring、取消和 stale generation。
- Transferable ownership 与 protocol version mismatch。
- 高 zoom fixture decode+build 性能采样，记录但本 Task 不单独宣称达到最终设备门槛。
- `pnpm --filter @nova/map3d test`、`pnpm check`。

## Status

DONE

## Findings

- 实现公共 fill/line layer 类型与五种 MVP 属性过滤；当前 Task 只构建 fill Polygon，Line geometry 保持 T009 范围。
- 实现 MVT ring 清理与 winding 分类、outer/hole 组织、Earcut 三角化和退化三角形过滤；输出 Tile 局部 Float32 XYZ positions、Uint32 indices、逐顶点 featureIds、feature ranges 和 tile-local feature table。
- 实现 `protocolVersion: 1` 的 build/cancel/success/error、可注入 `TileWorkerPool`、jobId/generation、stale/dispose 拒绝挂载、无效响应校验和输入/输出 transferable。
- 真实 KYE `z15/26978/12416` building fixture 生成 233 个可追溯 Feature 的单一 layer/material batch；测试覆盖 hole、多个 outer、无效 ring、空 layer、过滤、取消、decode error、版本不匹配和 transferable ownership。
- 安装并验证 `earcut` 3.2.3：ISC、ESM、内置 TypeScript 类型。Worker 产物为 35,645 bytes，Vite 报告 gzip 10.86 kB，未包含 Three.js。
- 2026-09-08 Node 开发环境对真实高 zoom building fixture 进行 30 次 decode+build 采样：median 1.9245 ms、P95 2.6880 ms、范围 1.5937–2.8242 ms，输出 1,425 vertices、957 triangles、34,284 bytes。该样本不是最终浏览器或目标设备性能结论。
- 验证命令通过：`pnpm --filter @nova/map3d typecheck`、`pnpm --filter @nova/map3d test`（11 files / 47 tests）、`pnpm --filter @nova/map3d build`、`pnpm check`。

## Open Issues

无。
