# T046 标准瓦片系统与性能面板

## Goal

提供标准 Web Mercator XYZ 瓦片加载、相机覆盖、混合 LOD、缓存命中、显示过渡和资源回收，并在 Playground 展示可导出的性能诊断。浏览器验收使用真实 KYE 数据和 WebGPU，入口为 `http://127.0.0.1:5173/`。

## Task Context Packet

### Must Read

- `AGENTS.md`
- `docs/project-state.md`
- `TASKS.md` 的 T046 行
- 本任务文件
- `KNOWLEDGE.md`
- `docs/evidence/index.md`
- `docs/ai-session-log.md`
- `docs/architecture/nova-tile-engine.md`
- `packages/map3d/src/nova-tile/engine.ts`
- `packages/map3d/src/Map3D.ts`
- `apps/playground/src/diagnosticsPanel.ts`

### Read If Needed

- `packages/map3d/src/nova-tile/**`：加载、覆盖、缓存、调度和上传问题。
- `packages/map3d/src/rendering/**`、`src/worker/**`、`src/geometry/**`、`src/mvt/**`：绘制和 Worker 性能问题。
- `packages/map3d/test/**`：对应模块回归。
- `docs/evidence/T046-*`：当前任务的指标和验证证据。

### Allowed Files

- `packages/map3d/src/**`、`packages/map3d/test/**` 中瓦片、相机、渲染和诊断相关模块。
- `apps/playground/**` 的指标面板、采样和样式。
- `tasks/T046-tile-system-full-lifecycle-repair.md`、`TASKS.md`、`PROJECT.md`、`KNOWLEDGE.md`、`docs/project-state.md`。
- `docs/architecture/nova-tile-engine.md`、`docs/knowledge/tile-runtime.md`、`docs/knowledge/performance.md`。
- `docs/evidence/T046-*`、`docs/evidence/index.md`、`docs/ai-session-log.md`、`docs/ai-sessions/2026-09-15.md`。

- `scripts/ai-governance/check-ai-governance.mjs`：任务状态与索引的一致性检查。

### Forbidden Files

- 运行时依赖版本、`pnpm-lock.yaml` 和无关业务模块。
- `docs/records/**` 和归档实现。

### Required Evidence

- canonical 请求复用、独立取消、超时、并发上限和上传推进测试。
- A→B→A 缓存命中、场景卸载、LRU 淘汰、延迟释放和 dispose 归零测试。
- 宽屏、日期线、倾角 0/20/40/60 和邻接 LOD 覆盖测试。
- 真实 WebGPU 连续运动、停止收敛、回访、倾角矩阵和 60 秒采样。
- `pnpm check`、`pnpm ai:check`、`git diff --check`。

### Stop Conditions

- 外部数据源持续不可用，真实浏览器环境无法提供验收数据。
- 修复涉及本任务以外的产品能力或依赖选型。

## Scope

- 使用 45° 垂直 FOV、256px XYZ zoom、实际 viewport aspect 与相机一致的地面投影。
- 以像素误差细分、可见多边形裁剪和父子合并维持有限数量与邻接层级连续。
- 使用粗层级覆盖和精细目标请求；canonical 数据身份跨相机更新复用，wrap 实例共享资源。
- moving 活动管线最多 8，停止阶段最多 12，生产 Worker Pool 最多 4。
- HTTP 请求支持独立消费者取消、8 秒超时、最多 3 次尝试和数据源节点轮换。
- 显示提交在帧边界执行；过渡持续 150ms，退出覆盖保留到过渡结束。
- 缓存使用 256 entries、128MiB CPU 和 256MiB GPU 预算，显示引用与缓存引用独立登记。
- 单个 Tile 超过 5MiB 上传字节额度时独占该帧；统计记录实际字节数。
- Worker 按有效样式选择 source layer；完整三角形复用顶点，跨界三角形执行精确裁剪。
- Playground 面板显示帧、请求、Worker、上传、缓存、场景、层级、相机及视口指标，并导出 JSON、timeline 和地图截图。

## Non-Goals

- 新增地图业务图层、地形、球面、拾取、文字排版或外部运行时依赖。
- 发布部署和依赖升级。

## Acceptance Criteria

- 目标就绪后覆盖完整，目标缺口和显示覆盖缺口分别可观测。
- 连续相机变化期间保持共享数据作业并持续启动所需请求。
- 停止后 Fetch、Worker、上传和过渡收敛；回访命中缓存时复用数据。
- 显示实例随覆盖挂载与卸载；缓存按预算淘汰，资源释放具备回归证据。
- WebGPU 实际交互、倾角矩阵、60 秒采样和生命周期验证具备可复核记录。
- CPU 帧 P95≤20ms、Worker P95≤25ms、上传 P95≤8ms、输入 P95≤50ms；冷启动、持续运动和空闲分开记录。
- 所有自动门禁通过；浏览器环境限制和性能尖峰在证据中标明。

## Status

VERIFYING

## Findings

- canonical 请求复用、并发限制、缓存淘汰、场景引用、相机投影、帧提交与指标面板已实现。
- 2026-09-15 `pnpm typecheck` 与 SDK 155 项测试通过。
- 真实 WebGPU 60 秒轨迹已验证停止收敛、缓存回访、并发预算、缓存预算和倾角矩阵。

## Open Issues

- 最终源码版本的真实浏览器性能、截图和生命周期验收正在采集。
