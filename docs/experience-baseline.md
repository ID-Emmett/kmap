# Kmap MVP Motion and Continuity Baseline

更新日期：2026-09-12

状态：D023-D025 已确认的 MVP 连续体验基线。本文定义 Tile 替换、交互阻尼和倾斜视角远景渐隐，并记录当前实现确认项；T010 已完成目标工作站发布判断。

## 目标

在首次地图数据已经可见后，pan、zoom、bearing 和 pitch 的连续操作不得暴露 Tile 请求、Worker 构建或 GPU 上传边界。地图应保持已有内容，逐步替换为目标数据，并以有界惯性和远景渐隐形成稳定的空间连续感。

## 当前代码确认

- T013 已实现 Target/Display Coverage、ready ancestor/descendant/outgoing fallback、display pin、最新目标 token 和短淡入；连续 zoom/pan 已完成双后端浏览器验证并获人工负责人接受。
- T014 已实现 pointer sample、release velocity、rAF/delta-time 指数阻尼、wheel 帧合并、取消规则和 reduced-motion 禁用释放惯性，并已于 2026-09-10 获人工负责人接受手感。
- T015 已实现 Polygon/Line 共享 TSL 远景渐隐，根据 pitch、camera target distance 和 ground footprint 更新 view-space fade 参数，并已于 2026-09-10 获人工负责人接受 pitch 0/20/40/60 观感。
- T021 已将旧 Display Coverage 更新为按空间区域判断：parent/fallback 仅在当前有效 Target 区域具备 ready replacement cohort 后退出，same-zoom/cache hit 直接完整显示；Render instance/material 在 render key 暂时移除后复用。该实现通过自动和浏览器回归，但 2026-09-11 人工 pan/zoom 加载观感明确不通过。
- T024 已在 V2 生产路径增加 rAF Render transaction gate、初始 parent fallback 请求和空间完整 Render Cover 提交；upload 完成不会立刻挂载 render key，parent 只在 replacement cohort 完整后退出。
- T025 已在 V2 生产路径移除 idle-only refinement debounce；运动期间可持续请求当前可见 refinement，leading/ordinary prefetch 不因 phase 自动归零，同角色请求通过 coverageRank 距离带轮询和 deadline/age starvation 诊断避免中心向外独占。

T013-T015 是当前已获人工接受的连续体验基线；T024 已修复 V2 提交事务与初始 fallback 缺口，T025 已修复 V2 运动调度闸门和队列公平性。T026/T027 仍需完成预加载预算和真实操作验收，T010 的数据只作为资源/帧时间安全门槛，不替代真实操作验收。

## 渐进式 Tile 展示

### 双覆盖模型

Tile Runtime 必须分离：

- Target Coverage：当前 ViewState 真正需要请求和最终显示的 Tile。
- Display Coverage：本帧实际挂载到 Scene 的 exact、fallback 和 outgoing Tile。

Tile lifecycle 继续描述数据状态；显示角色不得混入 `queued/fetching/decoding/building/ready` 状态机。

### Fallback 选择

对每个目标可见区域按以下顺序选择可显示内容：

1. 已 ready 的 exact target Tile。
2. 最近的已 ready ancestor Tile。
3. 能覆盖该区域的已 ready descendant/上一显示层级 Tile。
4. 若缓存没有可用 ancestor，调度一个低优先级父 Tile 请求作为 fallback。

Fallback 必须按正确 world wrap 和 MapOrigin 放置。它只作为目标数据未 ready 时的显示来源，不改变 canonical 请求去重规则。

### 提交与过渡

- Tile 只有完成 Fetch、Worker、GPU upload 并经过 rAF transaction gate 后才能进入 Display Coverage，禁止展示半成品 batch 或单 Tile upload 的局部画面。
- Exact Tile ready 后，在一个 animation frame 边界按空间完整 cohort 挂载，并在初始目标 180 ms 的过渡窗口内从 fallback 淡入；实现会话可在 120-250 ms 内根据双后端证据调整。
- Fallback/outgoing Tile 在替代范围完全覆盖且过渡结束后才解除 display pin，再交给 LRU。
- 快速连续 zoom 只允许最新 Target Coverage 完成显示提交；过时结果可以进入 cache，但不得覆盖更新后的视图。
- exact Tile 失败时保留可用 fallback，并通过已有 error/stats 报告 degraded coverage；不得为了等待失败 Tile 留出空白。
- 首次进入页面且没有任何可用数据时允许显示浅色背景；“无闪白”要求从首次可用显示覆盖建立之后开始。

### 资源与预算

- Display pin 与 visible/cache pin 分开记录，防止仍在屏幕上的 fallback 被 LRU 提前释放。
- 同时显示的 cohort 必须有界：正常最多为当前 exact 与一个 fallback/outgoing 层级；异常快速输入可合并到最新目标。
- 过渡资源计入 CPU/GPU bytes。短时超过 cache budget 时先停止 prefetch并报告 pressure，不释放仍参与显示的 fallback。
- Feature 仍不创建独立 Object3D，不引入跨 Tile 合批。

## 交互阻尼

### 运动状态

- 主动拖拽时保持直接跟手，不人为增加明显输入延迟。
- 使用最近一段有效 pointer samples 估算平移、bearing 和 pitch 速度。
- pointer 正常释放后进入基于 `requestAnimationFrame` 和真实 delta time 的惯性阶段，速度按指数阻尼衰减。
- 平移速度在 Web Mercator meters/second 中积分；bearing/pitch 使用 degrees/second，结果继续经过 ViewState 归一化。
- pitch/纬度触达限制时，对应速度分量必须停止，不能在边界抖动。
- 新 pointer、wheel、外部 `setView()`、dispose 或页面失活必须取消旧惯性。

### Wheel

Wheel 输入仍保持连续 zoom；短时间 wheel 事件合并到帧更新，避免一次事件一次突跳。MVP 不新增 zoom-to-cursor、pinch、多指旋转或完整触摸手势。

### 阻尼范围

阻尼参数已随 T014 人工接受成为当前 MVP 默认交互调校值。验收要求：

- 快速释放后存在可感知但有界的延续运动。
- 常规手势在约 0.2-1.2 秒内自然停止，极端输入不超过 1.5 秒。
- 30/60/120 Hz 模拟下相同初速度的终点差异保持在可解释容差内。
- 慢速精确拖动不得因最低速度阈值产生漂移。

MVP 默认启用惯性。尊重 `prefers-reduced-motion: reduce` 时禁用释放惯性和非必要长动画，但仍保留 Tile fallback 以防空白。

## 倾斜视角远景渐隐

- 远景渐隐只在 pitch 增大时平滑启用；pitch 0 的俯视图不得改变颜色或透明度。
- Polygon 和 Line 使用同一组按帧更新的 fade 参数，在 TSL / Node Material 中根据 camera/view-space distance 平滑混合到 Scene background/haze color。
- fogStart、fogEnd、loadCutoff 和 guard band 相对 Camera frame、viewport、zoom 与 pitch 自动推导，不能硬编码为只适合单一 zoom 的世界米数。
- 近景保持原样式可读；fogStart 后逐渐降低对比和 refinement，fogEnd 完整融合到浅色背景，不能出现固定截断线。
- fogEnd 之前不得用渐隐掩盖 Coverage 空洞、Tile seam 或资源不足；Tile 包围体完全超过 loadCutoff 后允许停止选择、请求、构建和渲染。
- loadCutoff 必须包含运动方向 guard band 和迟滞；与边界相交的 Tile 继续保留，不能按 Tile 中心粗暴裁剪。
- WebGPU 与 WebGL2 使用同一 TSL 节点路径；不新增独立 GLSL/WGSL 或 post-processing。
- Fade color 默认跟随 renderer background；MVP 不新增公开 atmosphere/style API。

## 验收场景

1. 固定网络延迟下，从 zoom 14.75 连续跨到 15.25，再返回 14.75。
2. 快速 zoom 14 → 16 → 15，验证过时层级不回跳。
3. 同 zoom 快速 pan 超出 prefetch ring，验证 parent fallback 和渐进替换。
4. pointer pan 与 bearing/pitch 快速释放，验证惯性、取消和边界停止。
5. pitch 0/20/40/60，对比近景清晰度、fogEnd 前 Coverage、远景渐隐连续性和 loadCutoff 外请求停止。
6. 上述场景分别在 WebGPU 和强制 WebGL2 执行，并在 `prefers-reduced-motion` 下复测。

## 最终判断

T013-T015 已完成首轮体验实现；D028 的 Retained Cache 已由 T020 完成，T021/T023 的人工 pan/zoom 观感明确不通过。T024 已完成 V2 Render transaction 和稳定 coarse cover，T025 已完成运动中连续加载调度与公平队列；T026/T027 继续完成预加载预算和逐帧人工验收。D029 Fog-Bounded Coverage 需在 V2 稳定后由 T022 更新本基线，最终由 T019 执行发布验收。体验是否达到“常用地图般连续”仍以人工负责人观看和实际操作接受为准；单张截图或单元测试不能替代该结论。
