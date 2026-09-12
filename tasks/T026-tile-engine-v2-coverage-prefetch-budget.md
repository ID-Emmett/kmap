# T026 TileEngineV2 Coverage and Prefetch Budget Separation

## Goal

解除 `visible.length` 对预加载容量的硬耦合，使 visible/coarse、refinement 和 leading/ordinary prefetch 使用独立的内部配额；在不提高既有 CPU/GPU/entry 总预算的前提下恢复可感知的提前加载。

## Scope

- 将 Coverage selector 的有效可见覆盖配额与 prefetch candidate 配额分离；`maxTiles=128` 不再直接把 prefetch 截断为 `maxTiles-visible.length`。
- 为 coverage-critical、visible refinement、leading prefetch、ordinary prefetch 定义内部 high/low water mark 和淘汰顺序。
- 继续由现有 entries、CPU bytes、GPU bytes 和 256 canonical entries 预算最终约束资源；压力时优先抑制/淘汰 ordinary 与 leading prefetch，不释放当前 Render Cover。
- 增加诊断：每类配额、被抑制原因、预算压力、恢复时间和实际 cache hit。
- 保持 mixed-LOD selector 的空间完整性、Canonical/Render TileKey 和公共 API；如需改变公开 `maxTiles` 语义，先返回 Project Control 确认。

## Non-Goals

- 不提高默认 Fetch/Worker 并发、CPU/GPU/entry 总预算。
- 不修改 Render transaction（T024）或 motion priority（T025）。
- 不实现磁盘缓存、Service Worker、跨实例共享 Cache 或公开 prefetch API。
- 不实现 T022 fogStart/fogEnd/loadCutoff。

## Acceptance Criteria

- 当 visible 接近 128 时，运动期间仍有非零 leading/ordinary prefetch，且诊断能说明其配额而非依赖剩余 Tile 数。
- 预算未受压时 prefetch 不会因 phase 自动归零；预算受压时按明确原因抑制，并在压力解除后恢复。
- coverage-critical 与 Render Cover 始终优先，任何淘汰不得造成有效区域空洞或 parent 退出。
- 受控 A → B → A 与 1500 ms 浏览器往返 pan 在未超预算时命中 retained cache，不重新 Fetch/Worker/upload。
- 三项资源预算、LRU、dispose、offline/recovery 和现有 T017/T020 测试无回归。

## Test Plan

- selector/scheduler 单测：visible=128、visible<128、prefetch candidate 超额、pressure high/low water mark。
- controlled runtime：记录各角色队列、抑制/恢复、cache hit/eviction 和资源字节。
- WebGPU/WebGL2：超宽 viewport、高 pitch、连续 pan/zoom、1500 ms 延迟与静止 30 秒。

## Status

BACKLOG

## Open Issues

- 预算配额属于内部实现；若产品要求公开调整 `maxTiles`，必须单独形成 Project Control 决策。
