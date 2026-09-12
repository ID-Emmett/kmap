/** 轻量 typed event emitter；不依赖 DOM EventTarget。 */
export class TypedEventEmitter<EventMap extends object> {
  readonly #listeners = new Map<keyof EventMap, Set<(event: never) => void>>();

  on<Type extends keyof EventMap>(
    type: Type,
    listener: (event: EventMap[Type]) => void,
  ): () => void {
    let listeners = this.#listeners.get(type);

    if (listeners === undefined) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }

    const stored = listener as (event: never) => void;
    listeners.add(stored);
    return () => {
      listeners?.delete(stored);
      if (listeners?.size === 0) {
        this.#listeners.delete(type);
      }
    };
  }

  emit<Type extends keyof EventMap>(type: Type, event: EventMap[Type]): void {
    const listeners = this.#listeners.get(type);

    if (listeners === undefined) {
      return;
    }

    for (const listener of [...listeners]) {
      (listener as (value: EventMap[Type]) => void)(event);
    }
  }

  clear(): void {
    this.#listeners.clear();
  }
}
