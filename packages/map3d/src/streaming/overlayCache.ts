export class ResponseCapacityError extends Error {}
/** URL 响应缓存与共享在途租约；网络缓冲和驻留响应具有独立硬预算。 */
export class OverlayCache {
  private readonly entries = new Map<string, { controller: AbortController; promise: Promise<ArrayBuffer>; users: number; bytes: number; ready: boolean }>();
  bytes = 0;
  pendingBytes = 0;
  constructor(readonly maxBytes = 8 * 1024 * 1024, readonly maxEntries = 128, readonly maxPendingBytes = 32 * 1024 * 1024) {}
  async read(url: string, signal: AbortSignal, loader: (signal: AbortSignal, reserve: (bytes: number) => void) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    signal.throwIfAborted();
    let entry = this.entries.get(url);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, promise: Promise.resolve(new ArrayBuffer(0)), users: 0, bytes: 0, ready: false };
      const item = entry;
      let reserved = 0;
      item.promise = loader(controller.signal, bytes => {
        if (this.pendingBytes + bytes - reserved > this.maxPendingBytes) throw new ResponseCapacityError('网络共享缓冲达到预算。');
        this.pendingBytes += bytes - reserved; reserved = bytes;
      }).then(buffer => {
        if (this.entries.get(url) === item) { item.bytes = buffer.byteLength; item.ready = true; this.bytes += item.bytes; }
        return buffer;
      }).catch(error => { if (this.entries.get(url) === item) this.entries.delete(url); throw error; })
        .finally(() => { this.pendingBytes -= reserved; });
      this.entries.set(url, item);
    } else { this.entries.delete(url); this.entries.set(url, entry); }
    const item = entry; item.users++;
    let onAbort: () => void = () => {};
    try {
      return await Promise.race([item.promise, new Promise<never>((_, reject) => {
        onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, { once: true });
      })]);
    } finally {
      signal.removeEventListener('abort', onAbort); item.users--;
      if (!item.ready && item.users === 0) { item.controller.abort(); if (this.entries.get(url) === item) this.entries.delete(url); }
      this.trim();
    }
  }
  private trim(): void {
    for (const [url, entry] of this.entries) {
      if (this.bytes <= this.maxBytes && this.entries.size <= this.maxEntries) break;
      if (entry.users || !entry.ready) continue;
      this.bytes -= entry.bytes; this.entries.delete(url);
    }
  }
  dispose(): void { for (const entry of this.entries.values()) entry.controller.abort(); this.entries.clear(); this.bytes = 0; }
}
