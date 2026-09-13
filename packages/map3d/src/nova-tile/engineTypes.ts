import type { CanonicalTileKey, RenderTileKey } from './tileAddress.js';
import type { MixedLODPlanner } from './lod/index.js';
import type { NovaTilePipeline } from './fetch/index.js';
import type { WorkerAdapter } from './worker/index.js';
import type { TileCache } from './cache/index.js';
import type { NovaTileRenderCover } from './render/index.js';
import type { TileUploadQueue } from './upload/index.js';
import type { TileResourceRegistry } from './resources/index.js';
import type { TileDiagnostics } from './diagnostics/index.js';
import type { NovaTileRecord } from './state.js';
import type { TileFetchPipeline } from './fetch/fetchPipeline.js';

/** NTE 的可注入数据源描述；只用于内部编排和确定性测试。 */
export interface NovaTileSourceOptions {
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly url?: string | ((key: CanonicalTileKey) => string);
}

/** 上传结果的最小资源描述。 */
export interface NovaTileUploadResult<Resource = unknown> {
  readonly resource?: Resource;
  readonly cpuBytes?: number;
  readonly gpuBytes?: number;
  readonly dispose?: () => void;
}

/** NovaTileEngine 的模块注入选项；未提供 source 时仅启用生命周期契约。 */
export interface NovaTileEngineOptions<Payload = unknown, WorkerInput = unknown, Resource = unknown> {
  readonly clock?: { now(): number };
  readonly source?: NovaTileSourceOptions;
  readonly worker?: WorkerAdapter<WorkerInput, Payload>;
  readonly pipeline?: NovaTilePipeline<WorkerInput, Payload>;
  readonly fetch?: TileFetchPipeline;
  readonly workerInput?: (key: CanonicalTileKey) => WorkerInput;
  readonly planner?: MixedLODPlanner;
  readonly scheduler?: import('./scheduler/index.js').RequestScheduler;
  readonly cache?: TileCache<Payload>;
  readonly renderCover?: NovaTileRenderCover;
  readonly uploadQueue?: TileUploadQueue<NovaTileUploadResult<Resource>>;
  readonly resources?: TileResourceRegistry<Resource>;
  readonly diagnostics?: TileDiagnostics;
  readonly upload?: (key: CanonicalTileKey, payload: Payload) => Promise<NovaTileUploadResult<Resource>> | NovaTileUploadResult<Resource>;
  readonly mapOriginId?: string;
  readonly uploadBytes?: (payload: Payload) => number;
}

export interface IntegratedRecord<Payload, Resource> {
  readonly record: NovaTileRecord<Payload>;
  readonly renderKey: RenderTileKey;
  readonly controller: AbortController;
  readonly resourceId: string;
  attempts: number;
  uploadQueued: boolean;
  resource?: NovaTileUploadResult<Resource>;
}
