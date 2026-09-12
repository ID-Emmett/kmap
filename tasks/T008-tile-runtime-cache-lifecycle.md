# T008 Implement Tile Runtime Cache and Lifecycle

## Goal

实现可见 Tile 驱动的请求调度、状态机、取消、重试、byte-aware LRU 缓存和资源生命周期编排，并用 fake source/worker/render adapter 独立验证。

## Scope

- TileRecord、合法状态转换和 generation token。
- visible/prefetch consumer、canonical 请求去重和 priority queue。
- Fetch concurrency、Worker concurrency、取消和 stale completion。
- 204 empty、failed cooldown、三次网络/5xx 重试和 idle 语义。
- CPU/GPU byte 估算、visible pin、LRU、256 entry/128 MiB/256 MiB 初始预算。
- memory-pressure、Tile stats、error/idle/stats typed events。
- dispose 顺序和所有 adapter 的释放编排。

## Non-Goals

- 不实现真实 Polygon/Line GPU 创建；测试使用 T004 或 fake adapters。
- 不改变 Worker payload、Camera 数学或公共 Layer style。
- 不实现持久化缓存、Service Worker、跨 Map3D 共享缓存或父子 Tile 多级 fallback。

## Inputs

- T003、T004、T007 输出。
- `docs/architecture.md` 的 Tile 状态、请求、缓存、资源所有权和错误事件。
- `docs/decisions.md` D015、D016、D018、D019。
- `docs/verification-baseline.md` 的 Scheduler/Cache/Lifecycle 测试要求。

## Constraints

- visible Tile 不因预算被强制销毁；超限时先关闭 prefetch 并报告压力。
- abort/cancel 不作为用户错误；重试耗尽才发送 error。
- 状态转换必须集中验证，禁止分散直接赋值造成非法状态。
- Runtime 依赖接口化 Source/Worker/Render adapter，避免万能 Manager。

## Acceptance Criteria

- 同一 canonical key 在多个 render wrap/consumer 下只 fetch/decode 一次。
- 优先级、并发、取消、retry/cooldown、empty 和 idle 可确定测试。
- LRU 依据实际 byte 估算淘汰非可见 Tile，Material/Geometry 释放回调只执行一次。
- stale Worker/GPU completion 不改变新 generation 或 disposed record。
- Map3D dispose 编排后请求、job、cache、events 和 loop 全部归零。

## Test Plan

- Fake clock + fake adapters 覆盖所有状态转换和竞争条件。
- 多 wrap 去重、快速 pan、zoom 变化、离线/恢复、204/404/500。
- CPU/GPU/entry 三类预算和 visible 超限。
- 三轮创建/销毁与 listener/job leak 检查。
- `pnpm --filter @nova/map3d test`、`pnpm check`。

## Status

DONE

## Findings

- 新增独立 `TileRuntime` 与集中校验的 `TileRecord` 状态机；canonical key 是唯一请求、Worker 和 cache key，多 world wrap 仅作为 consumer 合并。
- 调度顺序为 visible、屏幕距离、创建时间、稳定 key；Fetch 与 Worker 并发分别默认 8 和 4，Source adapter 复用 T004 的三次网络/5xx 重试与 204/404 语义。
- Runtime 级单调 generation、AbortSignal 和 Worker cancel 共同拒绝迟到结果，且不保留无界历史 key 表；迟到 GPU resource 会立即 dispose，主动取消不发送 error。
- Cache 默认 256 entries、128 MiB CPU、256 MiB GPU，按 adapter 报告的实际 byte 淘汰非 visible Tile；visible 超限保持 pinned，prefetch 被抑制并报告 pressure stats。
- `idle` 仅表示 visible Tile 没有工作，不被后台 prefetch 阻塞；Runtime 内部提供 error/idle/stats/memorypressure typed events。
- dispose 幂等，顺序为 Tile generation/resource → Worker adapter → Render adapter → Source adapter；三轮创建/销毁验证记录、事件、job 和 adapter 均归零。
- Runtime 与 adapter 类型保持内部模块，未扩大 D019 根导出或公共 `MapEventMap`；真实 Render adapter、render wrap 实例和 Map3D 动态接入由 T009 完成。
- 验证：`pnpm --filter @nova/map3d test -- tileRecord.test.ts tileRuntime.test.ts tileRuntimeCache.test.ts` 通过 22 项；`pnpm check` 通过 SDK 87 项与 Playground 1 项测试、类型检查及生产构建。

## Open Issues

- 精确并发默认值可在 T010 性能证据后调整，不改变状态和接口语义。
- CPU/GPU byte 精度取决于 T009 Render adapter 对 TypedArray 和 GPU buffer 的统计；T010 需在目标设备复核预算与峰值。
- T008 不创建真实 GPU 对象，因此无需新增浏览器人工验证；Map3D render loop 和动态 Tile 生命周期在 T009 集成后按双后端矩阵验证。
