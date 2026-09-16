import type { PaintRequest, PaintResponse } from './protocol.js';

interface Job { request: PaintRequest; resolve: (result: PaintResponse) => void; reject: (error: Error) => void }
/** Worker 固定并发；输入数据及输出背景位图、面与线的缓冲均转移所有权。 */
export class PaintWorkers {
  private readonly slots: { worker: Worker; job: Job | undefined }[] = [];
  private readonly queue: Job[] = [];
  private nextId = 0;
  private disposed = false;
  constructor(count = Math.min(4, Math.max(2, (navigator.hardwareConcurrency ?? 4) - 2))) {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./paint.worker.ts', import.meta.url), { type: 'module' });
      const slot = { worker, job: undefined as Job | undefined };
      worker.onmessage = (event: MessageEvent<PaintResponse>) => {
        const job = slot.job; slot.job = undefined;
        if (job) {
          if (event.data.error) job.reject(new Error(event.data.error)); else job.resolve(event.data);
        } else event.data.bitmap?.close();
        this.pump();
      };
      worker.onerror = (event) => { slot.job?.reject(new Error(event.message)); slot.job = undefined; this.pump(); };
      this.slots.push(slot);
    }
  }
  run(input: Omit<PaintRequest, 'id'>): Promise<PaintResponse> {
    if (this.disposed) return Promise.reject(new Error('Worker 已销毁。'));
    return new Promise((resolve, reject) => { this.queue.push({ request: { ...input, id: ++this.nextId }, resolve, reject }); this.pump(); });
  }
  getStats() { return { active: this.slots.filter(s => s.job).length, queued: this.queue.length }; }
  dispose(): void {
    this.disposed = true;
    for (const slot of this.slots) { slot.worker.terminate(); slot.job?.reject(new Error('Worker 已销毁。')); slot.job = undefined; }
    for (const job of this.queue.splice(0)) job.reject(new Error('Worker 已销毁。'));
  }
  private pump(): void {
    for (const slot of this.slots) {
      if (slot.job || this.queue.length === 0) continue;
      const job = this.queue.shift()!; slot.job = job;
      slot.worker.postMessage(job.request, [job.request.buffer]);
    }
  }
}
