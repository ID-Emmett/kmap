export interface TileUploadBudgetOptions {
  maxBytesPerFrame?: number;
  maxCommitsPerFrame?: number;
}

export interface TileUploadReservation {
  bytes: number;
  commit(): void;
  release(): void;
}

/** 每帧限制 GPU upload 和资源 commit，避免集中式主线程长任务。 */
export class TileUploadBudget {
  readonly #maxBytesPerFrame: number;
  readonly #maxCommitsPerFrame: number;
  #bytes = 0;
  #commits = 0;
  #totalCommits = 0;

  constructor(options: TileUploadBudgetOptions = {}) {
    this.#maxBytesPerFrame = normalizePositive(options.maxBytesPerFrame ?? 8 * 1024 * 1024, 'maxBytesPerFrame');
    this.#maxCommitsPerFrame = normalizePositive(options.maxCommitsPerFrame ?? 4, 'maxCommitsPerFrame');
  }

  beginFrame(): void {
    this.#bytes = 0;
    this.#commits = 0;
  }

  reserve(bytes: number): TileUploadReservation | undefined {
    if (!Number.isFinite(bytes) || bytes < 0) throw new RangeError('upload bytes 必须是非负有限数值。');
    if (this.#bytes + bytes > this.#maxBytesPerFrame || this.#commits >= this.#maxCommitsPerFrame) return undefined;
    this.#bytes += bytes;
    let released = false;
    let committed = false;
    return {
      bytes,
      commit: () => {
        if (released || committed) return;
        committed = true;
        this.#commits += 1;
        this.#totalCommits += 1;
      },
      release: () => {
        if (released || committed) return;
        released = true;
        this.#bytes -= bytes;
      },
    };
  }

  get usedBytes(): number { return this.#bytes; }
  get commitsThisFrame(): number { return this.#commits; }
  get totalCommits(): number { return this.#totalCommits; }
  get maxBytesPerFrame(): number { return this.#maxBytesPerFrame; }
  get maxCommitsPerFrame(): number { return this.#maxCommitsPerFrame; }
}

function normalizePositive(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new RangeError(`${name} 必须是正安全整数。`);
  return value;
}
