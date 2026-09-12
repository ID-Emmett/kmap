import { PbfWriter } from 'pbf';

type FixtureValue = string | number | boolean;

interface FixtureFeature {
  type: 1 | 2 | 3;
  tags: number[];
  geometry: number[];
}

interface FixtureLayer {
  name: string;
  version: number;
  extent: number;
  keys: string[];
  values: FixtureValue[];
  features: FixtureFeature[];
}

/** 构造覆盖 Polygon 多 ring、Line 和原始字段类型的最小 MVT。 */
export function createSyntheticMvt(version = 2): Uint8Array {
  const writer = new PbfWriter();
  const layer: FixtureLayer = {
    name: 'synthetic',
    version,
    extent: 4096,
    keys: ['name', 'height', 'visible'],
    values: ['polygon', 12, true, 'line'],
    features: [
      {
        type: 3,
        tags: [0, 0, 1, 1, 2, 2],
        geometry: [
          9, 0, 0,
          26, 20, 0, 0, 20, 19, 0,
          15,
          9, 4, 15,
          26, 0, 12, 12, 0, 0, 11,
          15,
        ],
      },
      {
        type: 2,
        tags: [0, 3],
        geometry: [9, 0, 0, 18, 20, 20, 20, 19],
      },
    ],
  };

  writer.writeMessage(3, writeLayer, layer);
  return writer.finish();
}

function writeLayer(layer: FixtureLayer, writer: PbfWriter): void {
  writer.writeStringField(1, layer.name);

  for (const feature of layer.features) {
    writer.writeMessage(2, writeFeature, feature);
  }
  for (const key of layer.keys) {
    writer.writeStringField(3, key);
  }
  for (const value of layer.values) {
    writer.writeMessage(4, writeValue, value);
  }

  writer.writeVarintField(5, layer.extent);
  writer.writeVarintField(15, layer.version);
}

function writeFeature(feature: FixtureFeature, writer: PbfWriter): void {
  writer.writePackedVarint(2, feature.tags);
  writer.writeVarintField(3, feature.type);
  writer.writePackedVarint(4, feature.geometry);
}

function writeValue(value: FixtureValue, writer: PbfWriter): void {
  switch (typeof value) {
    case 'string':
      writer.writeStringField(1, value);
      break;
    case 'number':
      writer.writeSVarintField(6, value);
      break;
    case 'boolean':
      writer.writeBooleanField(7, value);
      break;
  }
}
