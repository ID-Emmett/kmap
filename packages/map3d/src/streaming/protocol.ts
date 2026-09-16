import type { MapLayerOptions } from '../types.js';
import type { Address } from './address.js';
import type { LineData } from './lines.js';
import type { FillData } from './fills.js';
export interface PaintRequest { id: number; address: Address; buffer: ArrayBuffer; layers: readonly MapLayerOptions[]; background: string }
export interface PaintResponse { id: number; bitmap?: ImageBitmap; lines?: LineData; fills?: FillData; error?: string; features: number; paintMs: number; empty: boolean }
