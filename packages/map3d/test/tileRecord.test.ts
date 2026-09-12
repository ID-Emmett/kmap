import { describe, expect, it, vi } from 'vitest';

import {
  createTileRecord,
  disposeTileRecord,
  transitionTileRecord,
} from '../src/runtime/tileRecord.js';

const KEY = { sourceId: 'main', z: 3, x: 4, y: 2 } as const;

describe('TileRecord state machine', () => {
  it('只允许集中定义的状态转换', () => {
    const record = createTileRecord('main/3/4/2', KEY, 1, 0);

    transitionTileRecord(record, 'fetching', 1);
    transitionTileRecord(record, 'decoding', 2);
    transitionTileRecord(record, 'building', 3);
    transitionTileRecord(record, 'ready', 4);
    transitionTileRecord(record, 'disposed', 5);

    expect(record.state).toBe('disposed');
    expect(record.stateChangedAt).toBe(5);
    expect(() => transitionTileRecord(record, 'queued', 6)).toThrow(
      '不能从 disposed 转换到 queued',
    );
  });

  it('拒绝跳过阶段，并允许 204 和失败终态', () => {
    const invalid = createTileRecord('invalid', KEY, 1, 0);
    expect(() => transitionTileRecord(invalid, 'ready', 1)).toThrow(
      '不能从 queued 转换到 ready',
    );
    expect(invalid.state).toBe('queued');

    const empty = createTileRecord('empty', KEY, 1, 0);
    transitionTileRecord(empty, 'fetching', 1);
    transitionTileRecord(empty, 'empty', 2);
    expect(empty.state).toBe('empty');

    const failed = createTileRecord('failed', KEY, 1, 0);
    transitionTileRecord(failed, 'fetching', 1);
    transitionTileRecord(failed, 'failed', 2);
    expect(failed.state).toBe('failed');
  });

  it('dispose 幂等取消 job 并只释放一次资源', () => {
    const record = createTileRecord('dispose', KEY, 1, 0);
    const cancel = vi.fn();
    const dispose = vi.fn();
    record.job = { result: new Promise(() => {}), cancel };
    record.resource = {
      cpuBytes: 10,
      gpuBytes: 20,
      stats: { batches: 1, features: 1, vertices: 3, indices: 3, objects: 1 },
      dispose,
    };

    disposeTileRecord(record, 1);
    disposeTileRecord(record, 2);

    expect(record.state).toBe('disposed');
    expect(record.abortController.signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
