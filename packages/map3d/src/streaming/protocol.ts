import type { MapLayerOptions } from '../types.js';
import type { Address } from './address.js';
export interface PaintRequest { id: number; address: Address; buffer: ArrayBuffer; layers: readonly MapLayerOptions[]; background: string; size: number }
export interface PaintResponse { id: number; bitmap?: ImageBitmap; error?: string; features: number; paintMs: number; empty: boolean }
