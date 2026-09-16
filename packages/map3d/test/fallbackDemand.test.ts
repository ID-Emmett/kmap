import { describe, expect, it } from 'vitest';
import { canonicalKey, childrenOf, parentOf } from '../src/streaming/address.js';
import { fallbackRequests } from '../src/streaming/fallbackDemand.js';
import { resolveRenderCover } from '../src/streaming/renderCover.js';

describe('有限覆盖与细节补充需求', () => {
  const target = { z: 15, x: 26979, y: 12409 };
  const ancestor = parentOf(parentOf(parentOf(parentOf(target))));
  it('完整的四级祖先覆盖仍请求两级以内的补充数据', () => {
    const cover = resolveRenderCover([target], new Set([canonicalKey(ancestor)]), 0);
    expect(cover.uncovered).toBe(0);
    expect(fallbackRequests([target], cover.patches, 0, 8, () => false)).toEqual([parentOf(parentOf(target))]);
  });
  it('两级内可用覆盖与已确认空目标消除额外请求', () => {
    const near = parentOf(parentOf(target));
    const cover = resolveRenderCover([target], new Set([canonicalKey(near)]), 0);
    expect(fallbackRequests([target], cover.patches, 0, 8, () => false)).toEqual([]);
    expect(fallbackRequests([target], [], 0, 8, a => canonicalKey(a) === canonicalKey(target))).toEqual([]);
  });
  it('快速缩小时保留已经在构建且可以填补当前缺口的祖先', () => {
    expect(fallbackRequests([target], [], 0, 8, () => false, a => canonicalKey(a) === canonicalKey(ancestor))).toEqual([ancestor]);
  });
  it('祖先去重且真实缺口在限额内优先于已覆盖细节', () => {
    const missing = { ...target, x: target.x + 16 };
    const siblings = childrenOf(parentOf(target));
    const cover = resolveRenderCover(siblings, new Set([canonicalKey(ancestor)]), 0);
    expect(fallbackRequests([...siblings, missing], cover.patches, 0, 1, () => false)).toEqual([parentOf(parentOf(missing))]);
    expect(fallbackRequests(siblings, cover.patches, 0, 8, () => false)).toHaveLength(1);
  });
});
