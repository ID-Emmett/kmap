import { createTileBuildWorkerRuntime } from './runtime.js';

interface WorkerScope {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

const scope = globalThis as unknown as WorkerScope;
const runtime = createTileBuildWorkerRuntime((message, transfer) => {
  scope.postMessage(message, transfer);
});

scope.onmessage = (event) => {
  runtime.handleMessage(event.data);
};
