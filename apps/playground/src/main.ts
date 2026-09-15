import { Map3D } from '@kmap/map3d';
import type { Inspector } from 'three/addons/inspector/Inspector.js';
import { createDiagnosticsPanel } from './diagnosticsPanel.js';

import { PLAYGROUND_STYLE } from './mapStyle.js';
import './style.css';

interface InspectorWithTimestampResolution extends Inspector {
  resolveTimestamp(): Promise<void>;
}

async function bootstrap(): Promise<void> {
  window.__kmapMap3D?.dispose();
  const canvas = document.querySelector<HTMLCanvasElement>('#map-canvas');

  if (!canvas) {
    throw new Error('未找到 Playground Canvas。');
  }

  const forceWebGL =
    new URLSearchParams(window.location.search).get('renderer') === 'webgl2';
  const map = new Map3D({
    canvas,
    renderer: {
      forceWebGL,
      backgroundColor: PLAYGROUND_STYLE.backgroundColor,
    },
    source: {
      id: 'kye-main',
      tiles: [
        'https://tiles0.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf',
        'https://tiles1.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf',
        'https://tiles2.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf',
        'https://tiles3.kye-erp.com/v2/maptile-dispatch/data/v8Maptile/{z}/{x}/{y}.pbf',
      ],
      minZoom: 0,
      maxZoom: 17,
    },
    layers: PLAYGROUND_STYLE.layers,
    // 已验证 fixture z15/26978/12416 的 Tile 中心。
    view: {
      center: { lng: 116.3946533203125, lat: 39.90552253972854 },
      zoom: 15,
      bearing: 0,
      pitch: 0,
    },
  });
  window.__kmapMap3D = map;
  publishStatus({ state: 'initializing' });

  // Inspector 只在 Playground 接入，SDK 不依赖开发调试界面。
  let inspector: InspectorWithTimestampResolution | undefined;
  if (new URLSearchParams(window.location.search).has('inspector')) {
    const { Inspector } = await import('three/addons/inspector/Inspector.js');
    inspector = new Inspector() as InspectorWithTimestampResolution;
    window.__kmapInspector = inspector;
    map.getRenderer().inspector = inspector;
  }
  const removePanel = createDiagnosticsPanel(map);
  let ready = false;
  const unsubscribeView = map.on('viewchange', ({ view }) => {
    publishStatus({
      state: ready ? 'ready' : 'initializing',
      backend: map.getBackend(),
      view,
    });
  });

  const resize = (): void => {
    map.resize({
      width: canvas.clientWidth,
      height: canvas.clientHeight,
      pixelRatio: window.devicePixelRatio,
    });
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);

  try {
    resize();
    await map.initialize();
    if (new URLSearchParams(window.location.search).get('capture') === 'transitions') {
      const { runTransitionBenchmark } = await import('./transitionBenchmark.js');
      void runTransitionBenchmark(map, text => { const element = document.getElementById('benchmark-status'); if (element) element.textContent = text; });
    }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    ready = true;

    publishStatus({
      state: 'ready',
      backend: map.getBackend(),
      view: map.getView(),
      stats: map.getStats(),
    });
    console.info(
      'Kmap Map3D 动态 Polygon/Line Tile 已就绪。',
      document.documentElement.dataset.kmapStatus,
    );

    if (new URLSearchParams(window.location.search).get('lifecycle') === 'dispose') {
      resizeObserver.disconnect();
      unsubscribeView();
      removePanel();
      await disposeMapAfterInspectorQueries(map, inspector);
      publishStatus({ state: 'disposed', stats: map.getStats() });
      return;
    }

    window.addEventListener(
      'beforeunload',
      () => {
        resizeObserver.disconnect();
        unsubscribeView();
        removePanel();
        map.dispose();
      },
      { once: true },
    );
  } catch (error) {
    resizeObserver.disconnect();
    unsubscribeView();
    removePanel();
    throw error;
  }
}

if (import.meta.hot) import.meta.hot.dispose(() => window.__kmapMap3D?.dispose());

void bootstrap().catch(async (error: unknown) => {
  const structured = getStructuredError(error);
  const map = window.__kmapMap3D;
  if (map !== undefined) {
    await disposeMapAfterInspectorQueries(map, window.__kmapInspector);
  }
  publishStatus({ state: 'failed', error: structured });
  console.error('Kmap Playground 启动失败。', structured, error);
});

async function disposeMapAfterInspectorQueries(
  map: Map3D,
  inspector: InspectorWithTimestampResolution | undefined,
): Promise<void> {
  map.stop();
  try {
    await inspector?.resolveTimestamp();
  } finally {
    map.dispose();
  }
}

function publishStatus(status: Record<string, unknown>): void {
  window.__kmapStatus = status;
  document.documentElement.dataset.kmapStatus = JSON.stringify(status);
}

function getStructuredError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) {
    return { message: String(error) };
  }

  const candidate = error as Error & {
    code?: unknown;
    phase?: unknown;
    recoverable?: unknown;
    tileKey?: unknown;
  };
  return {
    name: candidate.name,
    message: candidate.message,
    code: candidate.code,
    phase: candidate.phase,
    recoverable: candidate.recoverable,
    tileKey: candidate.tileKey,
  };
}

declare global {
  interface Window {
    __kmapInspector?: InspectorWithTimestampResolution;
    __kmapMap3D?: Map3D;
    __kmapStatus?: Record<string, unknown>;
  }
}
