import type {
  LayerFilter,
  LayerPropertyValue,
} from '../types.js';

/** 判断 feature properties 是否满足全部 MVP 过滤条件。 */
export function matchesLayerFilters(
  properties: Readonly<Record<string, LayerPropertyValue>>,
  filters: readonly LayerFilter[] | undefined,
): boolean {
  if (filters === undefined || filters.length === 0) {
    return true;
  }

  return filters.every((filter) => matchesFilter(properties, filter));
}

function matchesFilter(
  properties: Readonly<Record<string, LayerPropertyValue>>,
  filter: LayerFilter,
): boolean {
  const hasProperty = Object.hasOwn(properties, filter.property);
  const value = properties[filter.property];

  switch (filter.operator) {
    case 'has':
      return hasProperty;
    case '==':
      return hasProperty && value === filter.value;
    case '!=':
      return !hasProperty || value !== filter.value;
    case 'in':
      return hasProperty && filter.values.includes(value ?? null);
    case '!in':
      return !hasProperty || !filter.values.includes(value ?? null);
  }
}
