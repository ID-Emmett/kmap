import type { TileCoverageEntry } from '../spatial/tileCoverage.js';
import type { TilePriorityRole } from '../spatial/tileCoverage.js';
import {
  canonicalTileKeyToString,
  renderTileKeyToString,
} from '../spatial/tileKey.js';
import type { CanonicalTileKey } from '../types.js';
import type { TileConsumer, TileRecord } from './tileRecord.js';

export interface TileConsumerGroup {
  id: string;
  key: CanonicalTileKey;
  consumers: Map<string, TileConsumer>;
  priorityRole: TilePriorityRole;
  visible: boolean;
  screenDistance: number;
  notBefore: number;
}

export function groupTileCoverage(
  entries: readonly TileCoverageEntry[],
): Map<string, TileConsumerGroup> {
  const groups = new Map<string, TileConsumerGroup>();

  for (const entry of entries) {
    const id = canonicalTileKeyToString(entry.key.canonical);
    const consumer: TileConsumer = {
      id: renderTileKeyToString(entry.key),
      key: entry.key,
      priorityRole: entry.priority.role,
      visible: entry.priority.visible,
      screenDistance: entry.priority.screenDistance,
      notBefore: entry.priority.notBefore ?? 0,
    };
    let group = groups.get(id);

    if (group === undefined) {
      group = {
        id,
        key: entry.key.canonical,
        consumers: new Map(),
        priorityRole: entry.priority.role,
        visible: false,
        screenDistance: Number.MAX_VALUE,
        notBefore: Number.POSITIVE_INFINITY,
      };
      groups.set(id, group);
    }

    if (priorityRoleRank(consumer.priorityRole) < priorityRoleRank(group.priorityRole)) {
      group.priorityRole = consumer.priorityRole;
    }

    if (consumer.visible) {
      if (!group.visible) {
        group.screenDistance = consumer.screenDistance;
      } else if (consumer.screenDistance < group.screenDistance) {
        group.screenDistance = consumer.screenDistance;
      }
      group.visible = true;
    } else if (!group.visible && consumer.screenDistance < group.screenDistance) {
      group.screenDistance = consumer.screenDistance;
    }
    group.notBefore = Math.min(group.notBefore, consumer.notBefore);
    group.consumers.set(consumer.id, consumer);
  }

  return groups;
}

export function compareTilePriority<Payload>(
  left: TileRecord<Payload>,
  right: TileRecord<Payload>,
): number {
  const roleDifference = priorityRoleRank(left.priorityRole) -
    priorityRoleRank(right.priorityRole);
  if (roleDifference !== 0) {
    return roleDifference;
  }
  if (left.visible !== right.visible) {
    return left.visible ? -1 : 1;
  }
  if (left.screenDistance !== right.screenDistance) {
    return left.screenDistance - right.screenDistance;
  }
  if (left.createdAt !== right.createdAt) {
    return left.createdAt - right.createdAt;
  }
  return left.id.localeCompare(right.id);
}

export function applyConsumerGroup<Payload>(
  record: TileRecord<Payload>,
  group: TileConsumerGroup | undefined,
  now: number,
): void {
  record.consumers = group === undefined
    ? new Map()
    : new Map(group.consumers);
  record.priorityRole = group?.priorityRole ?? 'prefetch';
  record.visible = group?.visible ?? false;
  record.screenDistance = group?.screenDistance ?? Number.MAX_VALUE;
  record.notBefore = group?.notBefore ?? now;
  if (group !== undefined) {
    record.retainUntil = undefined;
  }
  if (group !== undefined) {
    record.lastAccessedAt = now;
  }
}

function priorityRoleRank(role: TilePriorityRole): number {
  if (role === 'coverage') {
    return 0;
  }
  if (role === 'refinement') {
    return 1;
  }
  return role === 'leading-prefetch' ? 2 : 3;
}
