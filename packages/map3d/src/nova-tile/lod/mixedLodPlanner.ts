import type { ViewState, ViewportSize } from '../../types.js';
import { canonicalTileKeyToString, createCanonicalTileKey, type CanonicalTileKey } from '../tileAddress.js';
import { TilePyramid } from '../pyramid/index.js';
import { createGroundFootprint, footprintTileBounds, mercatorToTilePoint, type GroundFootprint } from '../coverage/index.js';

export interface LODPlannerOptions {
  readonly sourceId: string;
  readonly sourceRevision: string;
  readonly minZoom: number;
  readonly maxZoom: number;
  readonly tileBudget?: number;
  readonly refineThresholdPx?: number;
  readonly mergeThresholdPx?: number;
  readonly maxLodDelta?: number;
  readonly guardBand?: number;
}

export interface LODTileCandidate {
  readonly key: CanonicalTileKey;
  readonly sse: number;
  readonly distance: number;
  readonly region: 'near' | 'middle' | 'far';
  readonly selected: boolean;
}

export interface MixedLODPlan {
  readonly tiles: readonly LODTileCandidate[];
  readonly coverageComplete: boolean;
  readonly maxLodDelta: number;
  readonly footprint: GroundFootprint;
  readonly targetZoom: number;
  readonly diagnostics: {
    readonly refined: number;
    readonly merged: number;
    readonly budgetLimited: boolean;
    readonly pitch: number;
  };
}

/** 基于 SSE 的 best-first 混合 LOD 规划器，保持有限 Footprint 完整覆盖。 */
export class MixedLODPlanner {
  readonly #pyramid: TilePyramid;
  readonly #budget: number;
  readonly #refineThreshold: number;
  readonly #mergeThreshold: number;
  readonly #maxLodDelta: number;
  readonly #guardBand: number;

  constructor(options: LODPlannerOptions) {
    this.#pyramid = new TilePyramid(options);
    this.#budget = positive(options.tileBudget ?? 96, 'tileBudget');
    this.#refineThreshold = positiveNumber(options.refineThresholdPx ?? 320, 'refineThresholdPx');
    this.#mergeThreshold = positiveNumber(options.mergeThresholdPx ?? 224, 'mergeThresholdPx');
    this.#maxLodDelta = positive(options.maxLodDelta ?? 1, 'maxLodDelta');
    this.#guardBand = nonNegativeNumber(options.guardBand ?? 0, 'guardBand');
  }

  plan(view: ViewState, viewport: ViewportSize, previous: readonly CanonicalTileKey[] = []): MixedLODPlan {
    const footprint = createGroundFootprint(view, viewport, { guardBand: this.#guardBand });
    const targetZoom = Math.min(this.#pyramid.maxZoom, Math.max(this.#pyramid.minZoom, Math.floor(view.zoom)));
    const rootBounds = footprintTileBounds(footprint, this.#pyramid.minZoom);
    const leaves = new Map<string, CanonicalTileKey>();
    const refinementThreshold = previous.length > 0 ? Math.max(this.#refineThreshold, this.#mergeThreshold) : this.#refineThreshold;
    for (let y = rootBounds.minY; y <= rootBounds.maxY; y += 1) {
      for (let x = rootBounds.minX; x <= rootBounds.maxX; x += 1) {
        const key = createCanonicalTileKey(this.#pyramid.sourceId, this.#pyramid.sourceRevision, this.#pyramid.minZoom, x, y);
        if (key !== undefined) leaves.set(canonicalTileKeyToString(key), key);
      }
    }
    let refined = 0;
    let merged = 0;
    while (true) {
      const candidates = [...leaves.values()]
        .filter((key) => key.z < this.#pyramid.maxZoom)
        .map((key) => ({ key, score: this.score(key, view, viewport, footprint, targetZoom) }))
        .filter((entry) => entry.score > refinementThreshold)
        .sort((a, b) => b.score - a.score);
      const candidate = candidates[0];
      if (candidate === undefined || leaves.size + 3 > this.#budget) break;
      const children = this.#pyramid.children(candidate.key);
      leaves.delete(canonicalTileKeyToString(candidate.key));
      for (const child of children) leaves.set(canonicalTileKeyToString(child), child);
      refined += 1;
    }
    merged += this.balanceNeighbors(leaves);
    merged += this.balanceLevels(leaves);
    const balanced = this.enforceBudget(leaves, footprint);
    const tileEntries = [...balanced.values()].map((key) => {
      const score = this.score(key, view, viewport, footprint, targetZoom);
      return Object.freeze({ key, sse: score, distance: this.distance(key, view), region: this.region(key, view, viewport), selected: true });
    });
    tileEntries.sort((a, b) => a.key.z - b.key.z || canonicalTileKeyToString(a.key).localeCompare(canonicalTileKeyToString(b.key)));
    return Object.freeze({ tiles: Object.freeze(tileEntries), coverageComplete: this.isComplete(tileEntries, footprint), maxLodDelta: this.computeMaxLodDelta(tileEntries), footprint, targetZoom, diagnostics: Object.freeze({ refined, merged, budgetLimited: balanced.size >= this.#budget, pitch: view.pitch }) });
  }

  private score(key: CanonicalTileKey, view: ViewState, viewport: ViewportSize, footprint: GroundFootprint, targetZoom: number): number {
    const tileCenter = this.tileCenter(key);
    const viewPoint = mercatorToTilePoint(projectView(view), key.z);
    const distance = Math.max(0.5, Math.hypot(tileCenter.x * 2 ** key.z - viewPoint.x, tileCenter.y * 2 ** key.z - viewPoint.y));
    const tilePixels = Math.min(viewport.width, viewport.height) * 2 ** (key.z - targetZoom);
    const pitchFactor = 1 + Math.sin(Math.min(60, Math.max(0, view.pitch)) * Math.PI / 180) * (tileCenter.y * 2 ** key.z < viewPoint.y ? 1.5 : 0.5);
    const tileFootprint = footprintTileBounds(footprint, key.z);
    const intersects = key.x >= tileFootprint.minX && key.x <= tileFootprint.maxX && key.y >= tileFootprint.minY && key.y <= tileFootprint.maxY;
    return intersects ? tilePixels * pitchFactor / distance * 256 : 0;
  }

  private balanceNeighbors(leaves: Map<string, CanonicalTileKey>): number {
    let changed = 0;
    for (const key of [...leaves.values()]) {
      for (const neighbor of this.#pyramid.neighbors(key)) {
        const neighborLeaf = [...leaves.values()].find((entry) => this.overlapsAtZoom(entry, neighbor));
        if (neighborLeaf !== undefined && key.z - neighborLeaf.z > this.#maxLodDelta && leaves.size + 3 <= this.#budget) {
          leaves.delete(canonicalTileKeyToString(neighborLeaf));
          for (const child of this.#pyramid.children(neighborLeaf)) leaves.set(canonicalTileKeyToString(child), child);
          changed += 1;
        }
      }
    }
    return changed;
  }

  private balanceLevels(leaves: Map<string, CanonicalTileKey>): number {
    let changed = 0;
    let guard = 0;
    while (guard < 64) {
      guard += 1;
      const maxZoom = Math.max(...[...leaves.values()].map((entry) => entry.z));
      const coarse = [...leaves.values()].find((entry) => entry.z < maxZoom - this.#maxLodDelta);
      if (coarse === undefined) break;
      if (leaves.size + 3 <= this.#budget) {
        leaves.delete(canonicalTileKeyToString(coarse));
        for (const child of this.#pyramid.children(coarse)) leaves.set(canonicalTileKeyToString(child), child);
      } else {
        const deepest = [...leaves.values()].filter((entry) => entry.z === maxZoom)[0];
        if (deepest === undefined) break;
        const parent = this.#pyramid.parent(deepest);
        if (parent === undefined) break;
        for (const sibling of this.#pyramid.children(parent)) leaves.delete(canonicalTileKeyToString(sibling));
        leaves.set(canonicalTileKeyToString(parent), parent);
      }
      changed += 1;
    }
    return changed;
  }

  private enforceBudget(leaves: Map<string, CanonicalTileKey>, footprint: GroundFootprint): Map<string, CanonicalTileKey> {
    if (leaves.size <= this.#budget) return leaves;
    const result = new Map(leaves);
    while (result.size > this.#budget) {
      const child = [...result.values()].filter((entry) => entry.z > this.#pyramid.minZoom).sort((a, b) => this.score(a, { center: { lng: 0, lat: 0 }, zoom: a.z, bearing: 0, pitch: 0 }, { width: 1, height: 1 }, footprint, a.z) - this.score(b, { center: { lng: 0, lat: 0 }, zoom: b.z, bearing: 0, pitch: 0 }, { width: 1, height: 1 }, footprint, b.z))[0];
      if (child === undefined) break;
      const parent = this.#pyramid.parent(child);
      if (parent === undefined) break;
      for (const sibling of this.#pyramid.children(parent)) result.delete(canonicalTileKeyToString(sibling));
      result.set(canonicalTileKeyToString(parent), parent);
    }
    return result;
  }

  private isComplete(tiles: readonly LODTileCandidate[], footprint: GroundFootprint): boolean {
    const bounds = footprintTileBounds(footprint, this.#pyramid.minZoom);
    for (let y = bounds.minY; y <= bounds.maxY; y += 1) for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const root = createCanonicalTileKey(this.#pyramid.sourceId, this.#pyramid.sourceRevision, this.#pyramid.minZoom, x, y);
      if (root === undefined || !tiles.some((entry) => (entry.key.z === root.z && entry.key.x === root.x && entry.key.y === root.y) || this.#pyramid.isAncestor(root, entry.key))) return false;
    }
    return true;
  }

  private computeMaxLodDelta(tiles: readonly LODTileCandidate[]): number {
    let max = 0;
    for (const left of tiles) for (const right of tiles) max = Math.max(max, Math.abs(left.key.z - right.key.z));
    return max;
  }

  private overlapsAtZoom(key: CanonicalTileKey, target: CanonicalTileKey): boolean { const distance = Math.max(0, key.z - target.z); return Math.floor(key.x / 2 ** distance) === target.x && Math.floor(key.y / 2 ** distance) === target.y; }
  private tileCenter(key: CanonicalTileKey): { x: number; y: number } { const scale = 2 ** key.z; return { x: (key.x + 0.5) / scale, y: (key.y + 0.5) / scale }; }
  private distance(key: CanonicalTileKey, view: ViewState): number { const center = this.tileCenter(key); const target = mercatorToTilePoint(projectView(view), key.z); return Math.hypot(center.x * 2 ** key.z - target.x, center.y * 2 ** key.z - target.y); }
  private region(key: CanonicalTileKey, view: ViewState, viewport: ViewportSize): 'near' | 'middle' | 'far' { const d = this.distance(key, view); return d < Math.min(viewport.width, viewport.height) * 0.25 ? 'near' : d < Math.min(viewport.width, viewport.height) ? 'middle' : 'far'; }
}

function projectView(view: ViewState): { x: number; y: number } { const lat = Math.max(-85.05112878, Math.min(85.05112878, view.center.lat)) * Math.PI / 180; return { x: view.center.lng * Math.PI / 180 * 6_378_137, y: 6_378_137 * Math.log(Math.tan(Math.PI / 4 + lat / 2)) }; }
function positive(value: number, name: string): number { if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`); return value; }
function positiveNumber(value: number, name: string): number { if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name} 必须是正数。`); return value; }
function nonNegativeNumber(value: number, name: string): number { if (!Number.isFinite(value) || value < 0) throw new RangeError(`${name} 必须是非负数。`); return value; }
