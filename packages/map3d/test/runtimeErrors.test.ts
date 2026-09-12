import { describe, expect, it } from 'vitest';

import {
  createMapDisposedError,
  normalizeMapRuntimeError,
} from '../src/runtime/errors.js';
import { TileRequestError } from '../src/source/errors.js';
import { TileWorkerBuildError } from '../src/worker/pool.js';

const KEY = { sourceId: 'main', z: 15, x: 26978, y: 12416 } as const;

describe('Map runtime errors', () => {
  it('保留 request 错误并映射 Worker decode/build 字段', () => {
    const requestError = new TileRequestError({
      kind: 'http',
      code: 'HTTP_ERROR',
      message: 'Tile 请求返回 HTTP 404。',
      recoverable: false,
      tileKey: KEY,
      status: 404,
    });

    expect(normalizeMapRuntimeError(requestError, KEY)).toBe(requestError);

    const decodeError = normalizeMapRuntimeError(
      new TileWorkerBuildError({
        code: 'DECODE_ERROR',
        message: 'MVT 解码失败。',
        phase: 'decode',
        recoverable: false,
      }),
      KEY,
    );
    expect(decodeError).toMatchObject({
      name: 'MapRuntimeError',
      code: 'DECODE_ERROR',
      phase: 'decode',
      recoverable: false,
      tileKey: KEY,
    });

    const protocolError = normalizeMapRuntimeError(
      new TileWorkerBuildError({
        code: 'PROTOCOL_VERSION_MISMATCH',
        message: 'Worker 协议不匹配。',
        phase: 'protocol',
        recoverable: false,
      }),
      KEY,
    );
    expect(protocolError).toMatchObject({
      code: 'WORKER_ERROR',
      phase: 'build',
      recoverable: false,
      tileKey: KEY,
    });
  });

  it('未知初始化失败和已销毁状态均返回公共结构', () => {
    expect(normalizeMapRuntimeError(new Error('renderer init failed'), KEY)).toMatchObject({
      code: 'INITIALIZE_FAILED',
      phase: 'initialize',
      recoverable: false,
      tileKey: KEY,
    });
    expect(createMapDisposedError()).toMatchObject({
      code: 'MAP_DISPOSED',
      phase: 'dispose',
      recoverable: false,
    });
  });
});
