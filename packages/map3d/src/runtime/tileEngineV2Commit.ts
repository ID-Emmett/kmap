import type { TileRecord } from './tileRecord.js';

interface TileEngineV2CommitGateOptions<Payload> {
  readonly records: ReadonlyMap<string, TileRecord<Payload>>;
  readonly onCommit: () => void;
}

/** 将 upload 完成事件合并到浏览器帧边界，再开放给 Render Cover。 */
export class TileEngineV2CommitGate<Payload> {
  readonly #records: ReadonlyMap<string, TileRecord<Payload>>;
  readonly #eligibleReadyIds = new Set<string>();
  readonly #onCommit: () => void;
  #scheduled = false;
  #frame: number | undefined;
  #disposed = false;

  constructor(options: TileEngineV2CommitGateOptions<Payload>) {
    this.#records = options.records;
    this.#onCommit = options.onCommit;
  }

  get scheduled(): boolean {
    return this.#scheduled;
  }

  isEligible(record: TileRecord<Payload>): boolean {
    return this.#eligibleReadyIds.has(record.id);
  }

  resetRecord(id: string): void {
    this.#eligibleReadyIds.delete(id);
  }

  schedule(): void {
    if (this.#disposed || this.#scheduled) {
      return;
    }
    this.#scheduled = true;
    if (typeof requestAnimationFrame === 'function') {
      this.#frame = requestAnimationFrame(() => {
        this.#frame = undefined;
        this.#flush();
      });
      return;
    }
    queueMicrotask(() => this.#flush());
  }

  dispose(): void {
    this.#disposed = true;
    this.#scheduled = false;
    this.#eligibleReadyIds.clear();
    if (
      this.#frame !== undefined &&
      typeof cancelAnimationFrame === 'function'
    ) {
      cancelAnimationFrame(this.#frame);
    }
    this.#frame = undefined;
  }

  #flush(): void {
    if (this.#disposed || !this.#scheduled) {
      return;
    }
    this.#scheduled = false;
    for (const record of this.#records.values()) {
      if (record.state === 'ready' && record.resource !== undefined) {
        this.#eligibleReadyIds.add(record.id);
      }
    }
    this.#onCommit();
  }
}
