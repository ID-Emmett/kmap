import { expect, it } from 'vitest';
import { coveredFraction } from '../src/streaming/coverage.js';
import { childrenOf } from '../src/streaming/address.js';

it('重叠祖先和子级只计算一次覆盖，四个兄弟构成完整区域', () => {
  const target = { z: 3, x: 5, y: 2 }; const children = childrenOf(target);
  expect(coveredFraction(target, children)).toBe(1);
  expect(coveredFraction(target, [children[0]!, ...childrenOf(children[0]!)] )).toBe(.25);
  expect(coveredFraction(target, [children[0]!, children[1]!])).toBe(.5);
});
