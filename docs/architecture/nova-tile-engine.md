# NovaTileEngine 架构规范

更新日期：2026-09-13

## 1. 系统定位

`NovaTileEngine`（NTE）是 Nova 的普通地图瓦片流式引擎，负责从 ViewState 生成瓦片计划，完成数据加载、几何构建、GPU 上传、显示提交、缓存和资源回收。

## 2. 模块边界

```text
TileAddress
TilePyramid
GroundFootprint
TileCoverPlanner
MotionPredictor
TileRequestScheduler
TileFetchPipeline
TileWorkerBridge
TileCache
TileUploadQueue
TileRenderCover
TileResourceRegistry
TileDiagnostics
NovaTileEngine
```

模块职责：

| 模块 | 职责 |
| --- | --- |
| TileAddress | Canonical key、XYZ、wrap、source revision |
| TilePyramid | parent/children、邻接和 overzoom 关系 |
| GroundFootprint | 屏幕采样、射线反投影、有限地面范围 |
| TileCoverPlanner | 视锥裁剪、SSE、混合 LOD、数量预算 |
| MotionPredictor | 速度采样、预测 Footprint、方向权重 |
| TileRequestScheduler | 队列、Token Bucket、空间公平、去重 |
| TileFetchPipeline | HTTP、gzip、204、重试和冷却 |
| TileWorkerBridge | Decode、Geometry Build、transferable buffer |
| TileCache | Resident、Warm、Cold、Persistent 和字节预算 |
| TileUploadQueue | GPU 上传时间/字节预算和 backpressure |
| TileRenderCover | exact、fallback、Cohort、原子提交和过渡 |
| TileResourceRegistry | CPU/GPU ownership、引用计数、延迟释放 |
| TileDiagnostics | timeline、性能、资源和错误事件 |
| NovaTileEngine | 生命周期、帧循环和模块编排 |

## 3. 公共接口

`Map3D` 公共 API 使用现有 0.1 契约：

```ts
interface Map3D {
  initialize(): Promise<void>;
  resize(width: number, height: number, devicePixelRatio?: number): void;
  start(): void;
  stop(): void;
  dispose(): Promise<void>;
  getView(): ViewState;
  setView(view: ViewState): void;
  getBackend(): 'webgpu' | 'webgl2';
  getStats(): MapStats;
  on<K extends MapEventName>(event: K, listener: MapEventListener<K>): () => void;
  getRenderer(): unknown;
}
```

内部接口：

```ts
interface NovaTileEngine {
  initialize(): Promise<void>;
  resize(viewport: Viewport): void;
  updateView(view: ViewState): void;
  frame(frameTime: FrameTime): void;
  getStats(): TileStats;
  dispose(): Promise<void>;
}
```

## 4. 数据协议

- WGS84 经纬度作为公共坐标。
- Web Mercator meters 作为内部平面坐标。
- 标准 XYZ 作为瓦片地址。
- MVT v2、extent 4096、HTTP gzip 作为输入数据。
- HTTP 204 作为空瓦片结果。
- Worker protocol v1 传递 Polygon/Line batch 和 transferable buffers。
- Three.js WebGPU/WebGL2 负责 GPU 资源和渲染。

Canonical 数据键：

```ts
interface CanonicalTileKey {
  sourceId: string;
  sourceRevision: string;
  z: number;
  x: number;
  y: number;
}
```

Render 实例键：

```ts
interface RenderTileKey {
  canonical: CanonicalTileKey;
  wrapIndex: number;
  mapOriginId: string;
}
```

## 5. Tile 生命周期

```text
absent → planned → fetching → decoded → built → uploadQueued → ready → committed → retained → evicted
```

附加结果：`empty`、`retryable`、`failed`、`cancelled`、`stale`。

Tile 生命周期、Render Role 和 Cache Role 独立保存：

```text
lifecycleState：数据处理状态
renderRole：exact / ancestor / descendant / outgoing
cacheRole：resident / warm / cold
```

## 6. 初始化计划

初始化按以下顺序执行：

```text
读取 Source Metadata
→ 计算 Bootstrap Cover
→ Fetch / Decode / Build
→ 完整 Bootstrap Commit
→ Exact Refinement
→ Motion Lookahead Prefetch
```

Bootstrap 层级：

```ts
bootstrapZoom = clamp(floor(view.zoom) - 2, source.minZoom, source.maxZoom);
```

Bootstrap Cover 使用完整 Ground Footprint 和一圈 Guard Band。覆盖集合采用最小完整集合算法。

Bootstrap 典型数量：4～24 个 Tile，受 viewport、pitch、source 边界和 world wrap 影响。

Exact Refinement 典型数量：20～96 个 Tile，受 SSE、viewport、pitch 和资源预算影响。

首次提交条件：

- Cover 完整。
- GPU 资源 ready。
- Render instance 变换完成。
- 当前计划 epoch 有效。
- 提交在动画帧边界执行。

## 7. 地面覆盖与 LOD

Ground Footprint 采样点：

- 屏幕四角。
- 四条边中点。
- 高 pitch 地平线附近采样点。
- 运动方向前方采样点。

TileCoverPlanner 使用 Tile AABB、视锥和 Ground Footprint 执行四叉树遍历。

屏幕空间误差：

```text
SSE = geometricError × pixelsPerMeter × distanceFactor
```

阈值：

```text
SSE > 1.5px       继续细分
SSE < 0.75px      允许合并
0.75px～1.5px     保持层级
```

LOD 迟滞使用双帧确认。相邻 Tile 的层级差 `≤ 1`。

Tile 数量预算用于停止细分和兄弟合并。Ground Footprint 覆盖保持完整。

## 8. 倾斜视角

Pitch 视图采用距离分层：

| 区域 | LOD 策略 | 请求策略 |
| --- | --- | --- |
| 近景 | 高 LOD | 屏幕误差优先 |
| 中景 | 目标 zoom 或低一级 | 连续几何优先 |
| 远景 | 低 LOD | loadCutoff 与渐隐边界控制 |

高 pitch 的 Ground Footprint 使用有限 loadCutoff。Tile AABB 完全超过 loadCutoff 后进入远景终止状态。

## 9. 运动预测与预取

MotionPredictor 记录：

- 平移速度。
- bearing 速度。
- pitch 速度。
- 加速度。
- 运动方向。
- 预测置信度。

预测时间：

```text
慢速精确：150ms
普通移动：300ms
快速移动：500ms
```

预测 Footprint：

```text
currentFootprint + velocity × predictionTime + guardBand
```

预取规模为活动 Tile 的 20%～35%。

## 10. 请求调度

队列角色：

```text
visible-critical
visible-refinement
motion-lookahead
warm-prefetch
retry
```

优先级字段：

```text
coverageDeficit
screenError
motionAlignment
cacheReuseProbability
starvationAge
```

调度使用空间 Bucket 和加权轮询。每个 Bucket 获得持续配额，等待时间提升优先级。

运行阶段：

```text
moving → settling → settled → idle
```

| 资源 | moving | settled |
| --- | ---: | ---: |
| Fetch 并发 | 8 | 12 |
| 每帧新增请求 | 2～4 | 4～6 |
| Worker 并发 | 2～4 | 4 |
| Prefetch | 20%～35% | 0%～20% |

settling 阶段完成一轮当前可见 refinement。settled 阶段处理可见缺口和有限 refinement tail。idle 阶段处理重试和维护任务。

## 11. 加载管线

```text
Resident/Warm/Cold Cache
→ Persistent Cache
→ HTTP Fetch
→ Compressed MVT
→ Worker Decode
→ Worker Geometry Build
→ CPU Ready
→ Upload Queue
→ GPU Ready
→ Atomic Commit
```

请求共享规则：

- Canonical key 对应一个 Fetch Promise。
- Canonical key 对应一个 Decode job。
- Canonical key 对应一个 Build job。
- 多个 Render Instance 共享 CPU/GPU 数据。

异步结果包含 `jobId`、`generation`、`planEpoch` 和 Tile key。结果按照当前 epoch 执行提交。

## 12. Render Cover

集合定义：

```text
Target Cover       理想目标覆盖
Committed Cover    当前显示覆盖
Outgoing Cover     过渡中的旧覆盖
```

每个 Coverage Cell 使用 Cohort 提交：

```text
exact ready cohort
→ parent fallback 保持
→ animation frame atomic commit
→ exact fade-in
→ fallback fade-out
→ transition release
```

Committed Cover 的每帧不变量：

```text
coverageComplete = true
blankArea = 0
```

过渡时间 120～180ms。Resident 和 fallback 引用持续到 Cohort 替换完成。

## 13. 渲染与资源

Polygon 和 Line 使用 Tile Batch：

```text
Tile
 ├─ PolygonBatch[]
 └─ LineBatch[]
```

MVT extent 坐标转换到 Tile 局部 Web Mercator meters，再转换到 MapOrigin 相对 Float32。

Line casing/fill 共用几何拓扑，材质和渲染顺序保留独立批次属性。

Tile Render Adapter 负责：

- Batch 创建。
- MapOrigin 放置。
- material registry 获取。
- Render instance 生命周期。
- GPU 资源释放。

## 14. 缓存与内存

缓存层级：

```text
Resident → Warm → Cold → Persistent
```

当前预算：

| 资源 | 预算 |
| --- | ---: |
| CPU Tile Cache | 128MiB |
| GPU Tile Cache | 256MiB |
| Canonical Entries | 256 |
| 压缩 MVT | 32MiB 建议分配 |
| 解码后几何 | 96MiB 建议分配 |
| 临时缓冲 | 16MiB 建议分配 |

淘汰顺序：

```text
cold GPU → cold CPU → warm prefetch → compressed bytes
```

Resource Registry 保存：

```ts
interface TileResourceEntry {
  tileKey: CanonicalTileKey;
  cpuBytes: number;
  gpuBytes: number;
  refCount: number;
  lastUsedFrame: number;
  cacheRole: 'resident' | 'warm' | 'cold';
}
```

释放流程：解除 Render Cover 引用、解除 transition 引用、解除 upload 引用、进入延迟释放队列、在后续帧释放 GPU 资源。

HTTP 204 生成 empty record。404 和不可用瓦片生成 negative record。临时错误使用指数退避和冷却窗口。source revision 参与 Cache key。

## 15. Upload 与帧预算

UploadQueue 使用时间和字节双预算：

```text
frameUploadBytes ≤ 4～6MB
frameUploadTime ≤ 4ms
```

Render Commit：

```text
≤2 Cohort / frame
```

预算临界时，处理顺序为：

```text
visible-critical
→ exact visible
→ motion-lookahead
→ warm-prefetch
→ cache maintenance
```

## 16. 性能目标

| 指标 | 目标 |
| --- | ---: |
| Worker 单 Tile P95 | ≤25ms |
| WebGPU Frame P95 | ≤20ms |
| WebGL2 Frame P95 | ≤25ms |
| Upload P95 | ≤8ms |
| View 到下一帧响应 P95 | ≤50ms |
| 首次 Bootstrap Cover | 以真实浏览器证据记录 |
| 60 秒资源增长 | 稳定，无单调增长 |

主线程执行 ViewState、调度、上传、Commit 和统计。Worker 执行 Decode、Triangulation、Line Build 和 Feature 映射。

## 17. 诊断

每帧记录：

```ts
interface TileFrameDiagnostics {
  frameId: number;
  planEpoch: number;
  targetCover: TileCoverSummary;
  committedCover: TileCoverSummary;
  coverageComplete: boolean;
  blankArea: number;
  requestStarts: RequestEvent[];
  requestFinishes: RequestEvent[];
  cacheEvents: CacheEvent[];
  workerEvents: WorkerEvent[];
  uploadEvents: UploadEvent[];
  commitEvents: CommitEvent[];
  cpuBytes: number;
  gpuBytes: number;
  frameTime: number;
  longTasks: LongTaskEvent[];
}
```

关键统计：Bootstrap time、first complete cover time、refinement time、cache hit rate、duplicate request rate、cancel rate、Worker P95、Upload P95、Frame P95、blankArea、GPU resource count。

## 18. 完成标准

- 初始化完成 Bootstrap Cover 和 Exact Refinement。
- 2D、连续 zoom、pan、bearing、pitch 覆盖完整。
- 高 pitch 近中远 LOD 连续。
- 运动方向预取可观测。
- Fetch、Worker、Upload、Commit 预算稳定。
- Cache 命中、empty、negative、retry、eviction 可追踪。
- WebGPU/WebGL2、慢网、60 秒交互和 dispose 证据齐全。
- 自动测试、构建、性能指标和人工体验全部通过。
