# Tile Retention、Display Replacement 与 Fog-Bounded Coverage 诊断

研究日期：2026-09-10

## 研究目标

在 T017 mixed LOD 和 T018 motion-aware 调度实现后，诊断连续 pan 中出现的 Tile 闪烁、重复加载、中心向两侧逐步显示和高倾角远景 Tile 数量过多问题，为 Project Control 拆分后续任务提供事实输入。

## 浏览器诊断

状态：已验证；该采样用于定位问题，不是发布性能基线。

- 环境：本地 T017 browser harness，WebGPU，1280×720，DPR 1.5，zoom 15、bearing 0、pitch 60。
- 操作：中心从 116.3946533203125, 39.90552253972854 平移到东侧 116.4246533203125 后返回，采样窗口约 9 秒。
- 同一 canonical PBF 路径重复请求最高 17 次；去程与回程请求集合有 19 个相同路径。
- 重复请求使用不同 requestId，且不是 HTTP redirect。
- 代表路径包括 z14/13490/6209、z14/13491/6207、z12/3371/1550 和 z12/3373/1551。

结论：用户感知的“移除后重新加载”具有真实网络请求证据，不只是 opacity 或截图造成的视觉错觉。

## 代码已确认

- `TileRuntime.#applyDesiredConsumers()` 会立即释放无 active group、非 in-flight 且无 display consumer 的 terminal record。Ready Tile 离开 Target/Display 后无法作为离屏 LRU 继续驻留。
- 当前 LRU 只会淘汰仍存在于 records 中的对象；立即 dispose 发生在预算淘汰之前，因此名义 Cache 不能支持短距离往返 pan 的 Ready reuse。
- Display Coverage 会为 ready exact 预热两级 ancestor；ancestor ready 后不再属于 requested fallback，Runtime 随即释放它，下一轮同步再次发现缺失并重新请求，形成确定性循环。
- 当前 ready cache hit 测试主要命中 outgoing/display transition 保留，没有覆盖 Tile 完全离开 Target 与 Display 后的复用。
- Target signature 变化会整体清理既有 outgoing；新计划只要包含任意 exact，就可能启动全部 outgoing 淡出，缺少 parent/children 空间替换完整性判断。
- render key 移除会销毁 Render instance 与克隆材质；重新进入时再次创建。display opacity 跨 1 时会切换 material transparent 并标记 needsUpdate。
- Runtime idle 只等待 visible in-flight Tile，不能发现 prefetch/warm fallback 的后台请求循环。

## 行业方案适用性

- MapLibre 的 Tile Cache 与 parent/child retain、deck.gl TileLayer 的 best-available refinement 适合作为 Retained Cache 和空间替换参考，详见 `docs/research/tile-lod-scheduling.md`。
- Mapbox Fog 官方文档明确将减少远处 Tile 加载作为性能收益：<https://docs.mapbox.com/mapbox-gl-js/guides/globe/#atmosphere-styling>。
- Cesium 3D Tiles 的 screen-space error 与 dynamic screen-space error 说明远景/地平线方向可使用更积极的细节降低：<https://cesium.com/learn/cesiumjs/ref-doc/Cesium3DTileset.html>。
- 上述 Runtime 均与 Nova 的 Three.js、TSL、Worker 和 Tile ownership 强耦合边界不同，不建议直接引入完整引擎；应移植不变量和调度思想。

## Project Control 结论

- T017 mixed-LOD selector 保持 DONE；本次问题主要位于 Cache/Display/Render 生命周期。
- T018 的 motion-aware 实现自动证据保留，但人工体验验收失败；T020/T021 的旧路径修复完成后仍未通过人工观感，2026-09-11 由 D030/T023 改为建立独立 TileEngineV2，不再回到旧 Runtime 重新打补丁。
- 目标架构明确区分 Ideal Target Coverage、Render Cover 和 Retained Cache。
- 高倾角下使用 fogStart、fogEnd、loadCutoff 与 guard band 定义有效显示区域；fogEnd 之前必须完整覆盖，loadCutoff 之外允许停止选择、请求、构建和渲染。
- 实施先由 T020/T021 形成旧路径事实和失败证据，再由 T023 建立 TileEngineV2；T022 接入 V2 的 Fog-Bounded Coverage，最终由 T019 完成发布验证。
