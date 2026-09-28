import type { MapLayerOptions, TileOverlaySource } from '../types.js';
import type { Address } from './address.js';
import type { LineData } from './lines.js';
import type { FillData } from './fills.js';
import type { BuildingData } from './buildings.js';
import type { LabelCandidate } from '../labels/candidates.js';
export interface PaintRequest { id: number; address: Address; buffer: ArrayBuffer; layers: readonly MapLayerOptions[]; background: string; overlays?: readonly TileOverlaySource[] }
export interface PaintResponse { id: number; bitmap?: ImageBitmap; lines?: LineData; fills?: FillData; buildings?: BuildingData; labels?: LabelCandidate[]; error?: string; features: number; paintMs: number; empty: boolean }
