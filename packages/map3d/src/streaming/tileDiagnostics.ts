export type TileDiagnosticEventType =
  | 'view'
  | 'selected-cover'
  | 'request-start'
  | 'request-finish'
  | 'worker-start'
  | 'worker-finish'
  | 'upload'
  | 'cache'
  | 'commit'
  | 'frame'
  | 'long-task';

export interface TileDiagnosticEvent {
  type: TileDiagnosticEventType;
  at: number;
  tileId?: string;
  detail?: Readonly<Record<string, unknown>>;
}

/** 有界事件环形缓冲；timeline 可直接序列化为 evidence。 */
export class TileDiagnostics {
  readonly #limit: number;
  readonly #events: TileDiagnosticEvent[] = [];
  #dropped = 0;

  constructor(limit = 4_096) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new RangeError('diagnostics limit 必须是正安全整数。');
    this.#limit = limit;
  }

  record(event: TileDiagnosticEvent): void {
    if (!Number.isFinite(event.at)) throw new RangeError('diagnostic at 必须是有限数值。');
    const normalized = event.detail === undefined
      ? { type: event.type, at: event.at, ...(event.tileId === undefined ? {} : { tileId: event.tileId }) }
      : { type: event.type, at: event.at, ...(event.tileId === undefined ? {} : { tileId: event.tileId }), detail: Object.freeze({ ...event.detail }) };
    this.#events.push(normalized);
    if (this.#events.length > this.#limit) {
      this.#events.shift();
      this.#dropped += 1;
    }
  }

  snapshot(): Readonly<{ events: readonly TileDiagnosticEvent[]; dropped: number }> {
    return Object.freeze({ events: Object.freeze([...this.#events]), dropped: this.#dropped });
  }

  clear(): void {
    this.#events.length = 0;
    this.#dropped = 0;
  }
}
