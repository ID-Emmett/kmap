import type { TileEngineV2Schedule } from './tileEngineV2Schedule.js';
import type { TileConsumerGroup } from './tileRuntimePriority.js';

export interface TileEngineV2Diagnostics {
  readonly targetCoverage: readonly string[];
  readonly renderCover: readonly string[];
  readonly retainedCache: readonly string[];
  readonly scheduler: TileEngineV2Schedule['diagnostics'] | undefined;
  readonly cohortCommits: number;
  readonly requestQueue: readonly {
    id: string;
    role: TileConsumerGroup['priorityRole'];
    visible: boolean;
    screenDistance: number;
    notBefore: number;
  }[];
}
