/** 补充数据使用 canonical URL 共享请求；租约结束后取消闲置请求，LRU 有界保存响应。 */
export class OverlayCache {
  private readonly entries = new Map<string, { controller: AbortController; promise: Promise<ArrayBuffer>; users: number; bytes: number; ready: boolean }>();
  bytes = 0;
  constructor(readonly maxBytes = 8 * 1024 * 1024, readonly maxEntries = 128) {}
  async read(url: string, signal: AbortSignal, loader: (signal: AbortSignal) => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    signal.throwIfAborted();
    let entry = this.entries.get(url);
    if (!entry) {
      const controller = new AbortController();
      entry = { controller, promise: Promise.resolve(new ArrayBuffer(0)), users: 0, bytes: 0, ready: false };
      const item = entry;
      item.promise = loader(controller.signal).then(buffer => {
        if (this.entries.get(url) === item) { item.bytes = buffer.byteLength; item.ready = true; this.bytes += item.bytes; }
        return buffer;
      }).catch(error => { if (this.entries.get(url) === item) this.entries.delete(url); throw error; });
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
