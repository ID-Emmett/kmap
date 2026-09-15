import { describe, expect, it } from 'vitest';
import { createMapDisposedError, normalizeMapRuntimeError } from '../src/runtime/errors.js';
describe('公共错误契约', () => {
  it('销毁错误包含不可恢复的生命周期字段', () => { expect(createMapDisposedError()).toMatchObject({ code: 'MAP_DISPOSED', phase: 'dispose', recoverable: false }); });
  it('初始化错误保留原因和瓦片地址', () => {
    const cause = new Error('source'); const tileKey = { sourceId: 'a', z: 0, x: 0, y: 0 };
    expect(normalizeMapRuntimeError(cause, tileKey)).toMatchObject({ cause, tileKey, message: 'source', phase: 'initialize' });
  });
});
