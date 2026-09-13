import type { CanonicalTileKey } from '../tileAddress.js';
import type { PlanEpoch, TileGeneration } from '../epoch.js';

export const NOVA_TILE_WORKER_PROTOCOL_VERSION = 1 as const;
export interface NovaTileWorkerBuildRequest<PayloadInput = unknown> { readonly type: 'build'; readonly protocolVersion: 1; readonly jobId: number; readonly planEpoch: PlanEpoch; readonly generation: TileGeneration; readonly key: CanonicalTileKey; readonly data: ArrayBuffer; readonly input: PayloadInput; }
export interface NovaTileWorkerBuildSuccess<Payload = unknown> { readonly type: 'success'; readonly protocolVersion: 1; readonly jobId: number; readonly planEpoch: PlanEpoch; readonly generation: TileGeneration; readonly key: CanonicalTileKey; readonly payload: Payload; }
export interface NovaTileWorkerBuildError { readonly type: 'error'; readonly protocolVersion: 1; readonly jobId: number; readonly planEpoch: PlanEpoch; readonly generation: TileGeneration; readonly key: CanonicalTileKey; readonly error: { readonly code: string; readonly message: string; readonly recoverable: boolean }; }
export type NovaTileWorkerResponse<Payload = unknown> = NovaTileWorkerBuildSuccess<Payload> | NovaTileWorkerBuildError;
