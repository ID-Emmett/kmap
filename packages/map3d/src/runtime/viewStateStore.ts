import type { ViewState } from '../types.js';
import { normalizeViewState } from '../spatial/viewState.js';

export type ViewStateListener = (view: ViewState) => void;

/** 保存归一化 ViewState，并只在实际变化时通知订阅者。 */
export class ViewStateStore {
  readonly #listeners = new Set<ViewStateListener>();
  #view: ViewState;

  constructor(initial: Partial<ViewState> = {}) {
    this.#view = normalizeViewState(initial);
  }

  get(): ViewState {
    return cloneView(this.#view);
  }

  /** 帧内高频只读访问；返回内部对象，调用方不得修改，也不得跨帧保留。 */
  current(): ViewState {
    return this.#view;
  }

  set(update: Partial<ViewState>): boolean {
    const next = normalizeViewState(update, this.#view);

    if (viewsEqual(this.#view, next)) {
      return false;
    }

    this.#view = next;
    const event = cloneView(next);
    for (const listener of [...this.#listeners]) {
      listener(cloneView(event));
    }
    return true;
  }

  onChange(listener: ViewStateListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose(): void {
    this.#listeners.clear();
  }
}

function viewsEqual(left: ViewState, right: ViewState): boolean {
  return (
    left.center.lng === right.center.lng &&
    left.center.lat === right.center.lat &&
    left.zoom === right.zoom &&
    left.bearing === right.bearing &&
    left.pitch === right.pitch
  );
}

function cloneView(view: ViewState): ViewState {
  return { ...view, center: { ...view.center } };
}
