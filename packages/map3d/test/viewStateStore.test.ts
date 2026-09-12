import { describe, expect, it, vi } from 'vitest';

import { TypedEventEmitter } from '../src/runtime/events.js';
import { ViewStateStore } from '../src/runtime/viewStateStore.js';
import type { MapEventMap } from '../src/types.js';

describe('ViewStateStore and typed events', () => {
  it('只对实际变化通知并隔离可变 center', () => {
    const store = new ViewStateStore({
      center: { lng: 116.4, lat: 39.9 },
      zoom: 12,
    });
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);

    expect(store.set({ zoom: 12 })).toBe(false);
    expect(store.set({ bearing: 390 })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    const eventView = listener.mock.calls[0]?.[0];
    eventView.center.lng = 0;
    expect(store.get().center.lng).toBe(116.4);

    unsubscribe();
    store.set({ pitch: 20 });
    expect(listener).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it('typed emitter 可解除监听并整体清理', () => {
    const events = new TypedEventEmitter<MapEventMap>();
    const listener = vi.fn();
    const unsubscribe = events.on('viewchange', listener);
    const event = {
      view: {
        center: { lng: 0, lat: 0 },
        zoom: 3,
        bearing: 0,
        pitch: 0,
      },
    };

    events.emit('viewchange', event);
    unsubscribe();
    events.emit('viewchange', event);
    events.on('viewchange', listener);
    events.clear();
    events.emit('viewchange', event);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
