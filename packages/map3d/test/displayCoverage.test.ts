import { describe, expect, it } from 'vitest';

import {
  TileEngineV2DisplayCoordinator,
} from '../src/runtime/tileEngineV2DisplayCoordinator.js';
import type {
  TileEngineV2DisplayRecord,
} from '../src/runtime/tileEngineV2DisplayCoordinator.js';
import type { TileCoverageEntry } from '../src/spatial/tileCoverage.js';
import {
  canonicalTileKeyToString,
  createRenderTileKey,
} from '../src/spatial/tileKey.js';
import type { RenderTileKey } from '../src/spatial/types.js';

const SOURCE = 'main';

describe('TileEngineV2DisplayCoordinator', () => {
  it('优先显示 ready exact，并在过渡结束后稳定为 1', () => {
    const key = renderKey(3, 2, 2);
    const coordinator = new TileEngineV2DisplayCoordinator();
    const records = new Map([[recordId(key), record(key)]]);

    const initial = coordinator.update([visible(key)], records, 0);
    expect(initial.token).toBe(1);
    expect(initial.selections).toMatchObject([
      { recordId: recordId(key), role: 'exact', opacity: 1 },
    ]);
    expect(initial.requestedFallbacks).toEqual([
      renderKey(2, 1, 1),
      renderKey(1, 0, 0),
    ]);
    expect(initial.requiredFallbacks).toHaveLength(0);
    expect(initial.animating).toBe(false);

    const settled = coordinator.update([visible(key)], records, 180);
    expect(settled.selections).toMatchObject([
      { recordId: recordId(key), role: 'exact', opacity: 1 },
    ]);
    expect(settled.animating).toBe(false);
  });

  it('选择最近 ready ancestor 覆盖未就绪目标', () => {
    const target = renderKey(3, 5, 5);
    const parent = renderKey(2, 2, 2);
    const coordinator = new TileEngineV2DisplayCoordinator({ reducedMotion: true });
    const plan = coordinator.update(
      [visible(target)],
      new Map([[recordId(parent), record(parent)]]),
      0,
    );

    expect(plan.selections).toEqual([
      {
        recordId: recordId(parent),
        keys: [parent],
        opacity: 1,
        role: 'fallback',
      },
    ]);
    expect(plan.requestedFallbacks).toHaveLength(0);
  });

  it('没有 ancestor 时选择可覆盖目标的 ready descendants', () => {
    const target = renderKey(2, 2, 1);
    const children = [
      renderKey(3, 4, 2),
      renderKey(3, 5, 2),
      renderKey(3, 4, 3),
      renderKey(3, 5, 3),
    ];
    const records = new Map(
      children.map((key) => [recordId(key), record(key)]),
    );
    const coordinator = new TileEngineV2DisplayCoordinator({ reducedMotion: true });
    const plan = coordinator.update([visible(target)], records, 0);

    expect(plan.selections.map((selection) => selection.recordId).sort()).toEqual(
      children.map(recordId).sort(),
    );
    expect(plan.selections.every((selection) => selection.role === 'fallback')).toBe(true);
  });

  it('descendants 未完整覆盖目标时不提交部分显示', () => {
    const target = renderKey(2, 2, 1);
    const child = renderKey(3, 4, 2);
    const coordinator = new TileEngineV2DisplayCoordinator({ reducedMotion: true });
    const plan = coordinator.update(
      [visible(target)],
      new Map([[recordId(child), record(child)]]),
      0,
    );

    expect(plan.selections).toHaveLength(0);
  });

  it('目标变化时保留 outgoing，并请求低优先级 parent fallback', () => {
    const current = renderKey(3, 0, 0);
    const target = renderKey(3, 4, 2);
    const coordinator = new TileEngineV2DisplayCoordinator({ reducedMotion: true });
    const currentRecords = new Map([[recordId(current), record(current)]]);

    coordinator.update([visible(current)], currentRecords, 0);
    const plan = coordinator.update(
      [visible(target)],
      new Map(),
      10,
    );

    expect(plan.selections).toMatchObject([
      { recordId: recordId(current), role: 'outgoing', opacity: 1 },
    ]);
    expect(plan.requestedFallbacks).toEqual([renderKey(2, 2, 1)]);
    expect(plan.requiredFallbacks).toEqual([renderKey(2, 2, 1)]);
  });

  it('首次没有显示覆盖时派生 parent fallback 请求', () => {
    const target = renderKey(3, 4, 2);
    const coordinator = new TileEngineV2DisplayCoordinator();
    const plan = coordinator.update([visible(target)], new Map(), 0);

    expect(plan.selections).toHaveLength(0);
    expect(plan.requestedFallbacks).toEqual([renderKey(2, 2, 1)]);
    expect(plan.requiredFallbacks).toEqual([renderKey(2, 2, 1)]);
  });

  it('父级计算保留 world wrap，并为新目标生成 token', () => {
    const current = renderKey(3, 0, 0);
    const wrappedTarget = createRenderTileKey(SOURCE, 3, 8, 2);
    if (wrappedTarget === undefined) {
      throw new Error('测试 RenderTileKey 创建失败。');
    }
    const coordinator = new TileEngineV2DisplayCoordinator({ reducedMotion: true });
    coordinator.update(
      [visible(current)],
      new Map([[recordId(current), record(current)]]),
      0,
    );

    const plan = coordinator.update([visible(wrappedTarget)], new Map(), 1);
    expect(plan.token).toBe(2);
    expect(plan.requestedFallbacks).toEqual([renderKey(2, 0, 1, 1)]);
  });

  it('mixed LOD 目标以父级 fallback 渐进替换局部细分区域', () => {
    const stable = renderKey(2, 0, 1);
    const parent = renderKey(2, 2, 1);
    const children = [
      renderKey(3, 4, 2),
      renderKey(3, 5, 2),
      renderKey(3, 4, 3),
      renderKey(3, 5, 3),
    ];
    const coordinator = new TileEngineV2DisplayCoordinator();
    const initialRecords = new Map([
      [recordId(stable), record(stable)],
      [recordId(parent), record(parent)],
    ]);

    coordinator.update([visible(stable), visible(parent)], initialRecords, 0);
    const fallback = coordinator.update(
      [visible(stable), ...children.map(visible)],
      initialRecords,
      10,
    );

    expect(fallback.token).toBe(2);
    expect(fallback.selections).toMatchObject([
      { recordId: recordId(stable), role: 'exact', opacity: 1 },
      {
        recordId: recordId(parent),
        role: 'fallback',
        opacity: 1,
        keys: [parent],
      },
    ]);

    const readyRecords = new Map([
      ...initialRecords,
      ...children.map((key) => [recordId(key), record(key)] as const),
    ]);
    const transitioning = coordinator.update(
      [visible(stable), ...children.map(visible)],
      readyRecords,
      20,
    );

    expect(transitioning.animating).toBe(true);
    expect(transitioning.selections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recordId: recordId(parent),
          role: 'outgoing',
          opacity: 1,
        }),
        ...children.map((key) =>
          expect.objectContaining({
            recordId: recordId(key),
            role: 'exact',
            opacity: 0,
          }),
        ),
      ]),
    );

    const settled = coordinator.update(
      [visible(stable), ...children.map(visible)],
      readyRecords,
      200,
    );
    expect(settled.animating).toBe(false);
    expect(
      settled.selections.some((selection) => selection.recordId === recordId(parent)),
    ).toBe(false);
    expect(
      settled.selections.filter((selection) => selection.role === 'exact'),
    ).toHaveLength(5);
  });

  it('reduced motion 跳过淡入但仍保持 exact 显示', () => {
    const key = renderKey(3, 2, 2);
    const coordinator = new TileEngineV2DisplayCoordinator({ reducedMotion: true });
    const plan = coordinator.update(
      [visible(key)],
      new Map([[recordId(key), record(key)]]),
      0,
    );

    expect(plan.selections[0]).toMatchObject({ role: 'exact', opacity: 1 });
    expect(plan.animating).toBe(false);
  });

  it('不会请求低于 source minZoom 的 ancestor', () => {
    const key = renderKey(2, 2, 1);
    const coordinator = new TileEngineV2DisplayCoordinator({
      reducedMotion: true,
      minZoom: 2,
    });
    const plan = coordinator.update(
      [visible(key)],
      new Map([[recordId(key), record(key)]]),
      0,
    );

    expect(plan.requestedFallbacks).toHaveLength(0);
  });

  it('same-zoom pan 的 ready exact 直接完整显示，不启动淡入', () => {
    const current = renderKey(3, 0, 0);
    const next = renderKey(3, 1, 0);
    const coordinator = new TileEngineV2DisplayCoordinator();

    coordinator.update(
      [visible(current)],
      new Map([[recordId(current), record(current)]]),
      0,
    );
    const plan = coordinator.update(
      [visible(next)],
      new Map([[recordId(next), record(next)]]),
      10,
    );

    expect(plan.selections).toEqual([
      {
        recordId: recordId(next),
        keys: [next],
        opacity: 1,
        role: 'exact',
      },
    ]);
    expect(plan.animating).toBe(false);
  });

  it('replacement children 未完整 ready 时保持 parent，不提交部分 cohort', () => {
    const parent = renderKey(2, 2, 1);
    const children = [
      renderKey(3, 4, 2),
      renderKey(3, 5, 2),
      renderKey(3, 4, 3),
      renderKey(3, 5, 3),
    ];
    const coordinator = new TileEngineV2DisplayCoordinator();
    const parentRecords = new Map([[recordId(parent), record(parent)]]);

    coordinator.update([visible(parent)], parentRecords, 0);
    const partialRecords = new Map([
      ...parentRecords,
      [recordId(children[0]!), record(children[0]!)],
    ]);
    const partial = coordinator.update(
      children.map(visible),
      partialRecords,
      10,
    );

    expect(partial.selections).toEqual([
      {
        recordId: recordId(parent),
        keys: [parent],
        opacity: 1,
        role: 'fallback',
      },
    ]);
    expect(partial.animating).toBe(false);
  });

  it('初始 parent fallback ready 时不叠加部分 ready child', () => {
    const parent = renderKey(2, 2, 1);
    const children = [
      renderKey(3, 4, 2),
      renderKey(3, 5, 2),
      renderKey(3, 4, 3),
      renderKey(3, 5, 3),
    ];
    const coordinator = new TileEngineV2DisplayCoordinator();
    const partialRecords = new Map([
      [recordId(parent), record(parent)],
      [recordId(children[0]!), record(children[0]!)],
    ]);
    const partial = coordinator.update(
      children.map(visible),
      partialRecords,
      10,
    );

    expect(partial.selections).toEqual([
      {
        recordId: recordId(parent),
        keys: [parent],
        opacity: 1,
        role: 'fallback',
      },
    ]);
    expect(partial.animating).toBe(false);
  });

  it('无关 target 更新不会重启已有 LOD cohort 的过渡进度', () => {
    const parent = renderKey(2, 2, 1);
    const children = [
      renderKey(3, 4, 2),
      renderKey(3, 5, 2),
      renderKey(3, 4, 3),
      renderKey(3, 5, 3),
    ];
    const stable = renderKey(2, 0, 1);
    const coordinator = new TileEngineV2DisplayCoordinator();
    const initialRecords = new Map([[recordId(parent), record(parent)]]);

    coordinator.update([visible(parent)], initialRecords, 0);
    const readyRecords = new Map([
      ...initialRecords,
      ...children.map((key) => [recordId(key), record(key)] as const),
      [recordId(stable), record(stable)],
    ]);
    const started = coordinator.update(
      [visible(parent)],
      readyRecords,
      10,
    );
    expect(started.animating).toBe(false);

    const transitioning = coordinator.update(
      children.map(visible),
      readyRecords,
      20,
    );
    expect(transitioning.animating).toBe(true);
    const beforeUnrelatedUpdate = transitioning.selections.find(
      (selection) => selection.recordId === recordId(children[0]!),
    )?.opacity;

    const afterUnrelatedUpdate = coordinator.update(
      [visible(stable), ...children.map(visible)],
      readyRecords,
      50,
    );
    const afterOpacity = afterUnrelatedUpdate.selections.find(
      (selection) => selection.recordId === recordId(children[0]!),
    )?.opacity;

    expect(beforeUnrelatedUpdate).toBe(0);
    expect(afterOpacity).toBeCloseTo(30 / 180);
    expect(afterOpacity).toBeGreaterThan(beforeUnrelatedUpdate ?? 0);
  });
});

function renderKey(z: number, x: number, y: number, wrap = 0): RenderTileKey {
  const key = createRenderTileKey(SOURCE, z, x + wrap * 2 ** z, y);
  if (key === undefined) {
    throw new Error('测试 RenderTileKey 创建失败。');
  }
  return key;
}

function record(key: RenderTileKey): TileEngineV2DisplayRecord {
  return {
    id: recordId(key),
    key: key.canonical,
    ready: true,
    renderKeys: [key],
  };
}

function recordId(key: RenderTileKey): string {
  return canonicalTileKeyToString(key.canonical);
}

function visible(key: RenderTileKey): TileCoverageEntry {
  return {
    key,
    kind: 'visible',
    priority: { role: 'coverage', visible: true, screenDistance: 0 },
  };
}

