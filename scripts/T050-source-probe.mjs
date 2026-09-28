/** T050 高德影像源抽样：记录各节点有效层级和无影像占位图的内容身份。 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const output = join(root, 'docs', 'evidence', 'satellite-basemap');
mkdirSync(output, { recursive: true });
const center = { lng: 116.3946533203125, lat: 39.90552253972854 };
const addressAt = z => {
  const scale = 2 ** z;
  const latitude = center.lat * Math.PI / 180;
  return { z, x: Math.floor((center.lng + 180) / 360 * scale),
    y: Math.floor((1 - Math.asinh(Math.tan(latitude)) / Math.PI) / 2 * scale) };
};
const addresses = [{ z: 0, x: 0, y: 0 }, ...[1, 6, 17, 18, 19].map(addressAt)];
const records = [];
for (const node of [1, 2, 3, 4]) for (const address of addresses) {
  const url = `https://webst0${node}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=6&x=${address.x}&y=${address.y}&z=${address.z}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(12000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    const format = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpeg' : 'unknown';
    const dimensions = format === 'png' ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : undefined;
    records.push({ node, address, status: response.status, contentType: response.headers.get('content-type'),
      bytes: bytes.byteLength, format, dimensions, sha256: createHash('sha256').update(bytes).digest('hex') });
  } catch (error) {
    records.push({ node, address, error: String(error) });
  }
}
const report = { at: new Date().toISOString(), source: '高德 webst01..04 style=6', center, records };
writeFileSync(join(output, 'T050-source-sample.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ at: report.at, byZoom: Object.fromEntries(addresses.map(address => [address.z,
  records.filter(record => record.address.z === address.z).map(({ node, status, format, bytes, sha256, error }) =>
    ({ node, status, format, bytes, sha256, error }))])) }, null, 2));
if (records.some(record => record.error || record.status !== 200)) process.exitCode = 1;
