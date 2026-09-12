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
  coverageRank: number;
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
      coverageRank: entry.priority.coverageRank ?? Number.MAX_SAFE_INTEGER,
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
        coverageRank: Number.MAX_SAFE_INTEGER,
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
    group.coverageRank = Math.min(group.coverageRank, consumer.coverageRank);
    group.notBefore = Math.min(group.notBefore, consumer.notBefore);
    group.consumers.set(consumer.id, consumer);
  }

  return groups;
}

export function compareTilePriority<Payload>(
  left: TileRecord<Payload>,
  right: TileRecord<Payload>,
  now = Number.NEGATIVE_INFINITY,
): number {
  const roleDifference = priorityRoleRank(left.priorityRole) -
    priorityRoleRank(right.priorityRole);
  if (roleDifference !== 0) {
    return roleDifference;
  }
  if (left.visible !== right.visible) {
    return left.visible ? -1 : 1;
  }
  const leftStarved = isTilePriorityStarved(left, now);
  const rightStarved = isTilePriorityStarved(right, now);
  const starvationDifference = Number(rightStarved) - Number(leftStarved);
  if (starvationDifference !== 0) {
    return starvationDifference;
  }
  if (leftStarved && rightStarved) {
    const deadlineDifference =
      getTilePriorityDeadlineAt(left) - getTilePriorityDeadlineAt(right);
    if (deadlineDifference !== 0) {
      return deadlineDifference;
    }
    if (left.stateChangedAt !== right.stateChangedAt) {
      return left.stateChangedAt - right.stateChangedAt;
    }
  }
  if (left.coverageRank !== right.coverageRank) {
    return left.coverageRank - right.coverageRank;
  }
  if (left.screenDistance !== right.screenDistance) {
    return left.screenDistance - right.screenDistance;
  }
  if (left.stateChangedAt !== right.stateChangedAt) {
    return left.stateChangedAt - right.stateChangedAt;
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
  record.coverageRank = group?.coverageRank ?? Number.MAX_SAFE_INTEGER;
  record.notBefore = group?.notBefore ?? now;
  if (group !== undefined) {
    record.retainUntil = undefined;
  }
  if (group !== undefined) {
    record.lastAccessedAt = now;
  }
}

export function getTilePriorityDeadlineAt<Payload>(
  record: TileRecord<Payload>,
): number {
  return record.stateChangedAt + getRoleDeadlineMs(record.priorityRole);
}

export function isTilePriorityStarved<Payload>(
  record: TileRecord<Payload>,
  now: number,
): boolean {
  return Number.isFinite(now) && getTilePriorityDeadlineAt(record) <= now;
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

function getRoleDeadlineMs(role: TilePriorityRole): number {
  if (role === 'coverage') {
    return 120;
  }
  if (role === 'refinement') {
    return 240;
  }
  return role === 'leading-prefetch' ? 480 : 960;
}
