import { describe, expect, it } from 'vitest';

import { matchesLayerFilters } from '../src/geometry/filter.js';

const PROPERTIES = {
  kind: 'park',
  level: 2,
  active: false,
  nullable: null,
};

describe('matchesLayerFilters', () => {
  it('支持 ==、!=、in、!in 和 has', () => {
    expect(
      matchesLayerFilters(PROPERTIES, [
        { operator: '==', property: 'kind', value: 'park' },
        { operator: '!=', property: 'level', value: 3 },
        { operator: 'in', property: 'level', values: [1, 2] },
        { operator: '!in', property: 'kind', values: ['water'] },
        { operator: 'has', property: 'nullable' },
      ]),
    ).toBe(true);
  });

  it('明确处理缺失字段和 null', () => {
    expect(
      matchesLayerFilters(PROPERTIES, [
        { operator: '==', property: 'missing', value: null },
      ]),
    ).toBe(false);
    expect(
      matchesLayerFilters(PROPERTIES, [
        { operator: '!=', property: 'missing', value: null },
        { operator: '!in', property: 'missing', values: [null] },
        { operator: '==', property: 'nullable', value: null },
      ]),
    ).toBe(true);
    expect(
      matchesLayerFilters(PROPERTIES, [
        { operator: 'has', property: 'missing' },
      ]),
    ).toBe(false);
  });
});
