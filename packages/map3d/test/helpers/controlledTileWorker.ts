import { createTileBuildWorkerRuntime } from '../../src/worker/runtime.js';
import type { TileBuildWorkerAdapter } from '../../src/worker/pool.js';
import type {
  TileWorkerRequestV1,
  TileWorkerResponseV1,
} from '../../src/worker/protocol.js';

/** 使用 structuredClone transfer 模拟真实 Worker 所有权语义。 */
export class ControlledTileWorker implements TileBuildWorkerAdapter {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly detachedOutputBuffers: number[] = [];
  terminated = false;

  readonly #requests: TileWorkerRequestV1[] = [];
  readonly #runtime = createTileBuildWorkerRuntime((message, transfer) => {
    const cloned = structuredClone(message, { transfer });
    this.detachedOutputBuffers.push(...transfer.map((buffer) => buffer.byteLength));
    this.onmessage?.({ data: cloned } as MessageEvent<TileWorkerResponseV1>);
  });

  postMessage(
    message: TileWorkerRequestV1,
    transfer: Transferable[] = [],
  ): void {
    if (this.terminated) {
      throw new Error('ControlledTileWorker 已终止。');
    }

    const cloned = structuredClone(message, { transfer });
    this.#requests.push(cloned);
  }

  terminate(): void {
    this.terminated = true;
    this.#requests.length = 0;
  }

  /** 处理当前队列，并等待 runtime 的零延迟构建任务完成。 */
  async drain(): Promise<void> {
    for (let pass = 0; pass < 20; pass += 1) {
      let request = this.#requests.shift();

      while (request !== undefined) {
        this.#runtime.handleMessage(request);
        request = this.#requests.shift();
      }

      await new Promise((resolve) => setTimeout(resolve, 0));

      if (this.#requests.length === 0) {
        return;
      }
    }

    throw new Error('ControlledTileWorker 队列未能清空。');
  }
}
