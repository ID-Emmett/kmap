import type { Map3DOptions, MapLayerOptions } from '../types.js';
import { requestUrl, type Address } from './address.js';
import { overlayAddress, packTileSources } from './tileSources.js';
import type { OverlayCache } from './overlayCache.js';
import { TILE_LIMITS } from './limits.js';

/** 网络层只返回请求地址对应的内容；空主源由覆盖树选择可用祖先。 */
export async function requestTile(address: Address, source: Map3DOptions['source'], attempt: number,
  cache: OverlayCache, signal: AbortSignal, reserve: (bytes: number) => void, http: (elapsed?: number) => void,
  layers?: readonly MapLayerOptions[],
): Promise<{ buffer: ArrayBuffer; empty: boolean; primaryEmpty: boolean }> {
  const templates = [...source.tiles];
  if (attempt > 1) templates.push(...templates.splice(0, (attempt - 1) % templates.length));
  const read = (url: string) => cache.read(url, signal, async (sharedSignal, reserveShared) => {
    const started = performance.now(); http();
    const response = await fetch(url, { signal: sharedSignal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = response.status === 204 ? new ArrayBuffer(0) : await readTileBody(response, reserveShared);
    http(performance.now() - started); return body;
  });
  const primary = await read(requestUrl(address, templates));
  // 主源与辅助来源分别完成读取；来源的无内容响应只影响其自身图层。
  if (!primary.byteLength && !source.overlays?.length) return { buffer: primary, empty: true, primaryEmpty: true };
  reserve(primary.byteLength * 3);
  const parts: ArrayBuffer[] = [primary];
  const unique = new Set<ArrayBuffer>(parts); let bytes = primary.byteLength;
  for (const overlay of source.overlays ?? []) {
    const visible = !layers || layers.some(layer => layer.sourceLayer === overlay.targetLayer
      && address.z < (layer.maxZoom ?? 25));
    const part = !visible || address.z < overlay.minZoom || overlay.onlyWhenPrimaryEmpty && primary.byteLength
      ? new ArrayBuffer(0) : await read(requestUrl(overlayAddress(address, overlay), overlay.tiles));
    if (!unique.has(part)) { unique.add(part); bytes += part.byteLength; }
    if (bytes > TILE_LIMITS.requestBytes) throw new Error('MVT 组合响应超出预算。');
    reserve(bytes * 3); parts.push(part);
  }
  return { buffer: source.overlays?.length ? packTileSources(parts) : primary.slice(0), empty: !bytes, primaryEmpty: !primary.byteLength };
}

/** 网络体的上界独立于订阅条目，共享请求的取消由租约计数决定。 */
async function readTileBody(response: Response, reserve: (bytes: number) => void): Promise<ArrayBuffer> {
  if (!response.body) return new ArrayBuffer(0);
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let total = 0;
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > TILE_LIMITS.requestBytes) throw new Error('MVT 响应超出预算。');
      reserve(total * 2);
      chunks.push(chunk.value);
    }
    const result = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result.buffer;
  } catch (error) { await reader.cancel(); throw error; }
  finally { reader.releaseLock(); }
}
