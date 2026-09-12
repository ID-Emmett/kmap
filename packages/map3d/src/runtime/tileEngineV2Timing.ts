import { isTileRecordInFlight } from './tileRecord.js';
import type { TileRecord } from './tileRecord.js';

export const TILE_CANCEL_GRACE_MS = 240;
export const TILE_PROGRESS_CANCEL_GRACE_MS = 600;

export function isTileEngineV2GroupReady<Payload>(
  record: TileRecord<Payload> | undefined,
): boolean {
  return record?.state === 'ready' || record?.state === 'empty';
}

export function scheduleTileEngineV2Wakeup<Payload>(input: {
  readonly useRealClock: boolean;
  readonly disposed: boolean;
  readonly now: number;
  readonly records: ReadonlyMap<string, TileRecord<Payload>>;
  readonly getTimer: () => ReturnType<typeof setTimeout> | undefined;
  readonly setTimer: (timer: ReturnType<typeof setTimeout> | undefined) => void;
  readonly onWake: () => void;
}): void {
  if (!input.useRealClock || input.disposed) {
    return;
  }
  const wakeAt = [...input.records.values()].reduce(
    (earliest, record) => {
      if (record.state === 'queued' && record.notBefore > input.now) {
        return Math.min(earliest, record.notBefore);
      }
      if (
        isTileRecordInFlight(record.state) &&
        record.consumers.size === 0 &&
        record.retainUntil !== undefined &&
        record.retainUntil > input.now
      ) {
        return Math.min(earliest, record.retainUntil);
      }
      return earliest;
    },
    Number.POSITIVE_INFINITY,
  );
  const currentTimer = input.getTimer();
  if (currentTimer !== undefined) {
    clearTimeout(currentTimer);
    input.setTimer(undefined);
  }
  if (!Number.isFinite(wakeAt)) {
    return;
  }
  input.setTimer(setTimeout(() => {
    input.setTimer(undefined);
    if (!input.disposed) {
      input.onWake();
    }
  }, Math.max(0, wakeAt - input.now)));
}
