/** OpenFreeMap Liberty 道路表达式；256px 世界尺度对应其 512px zoom + 1。
 * 来源、数值快照与核验见 docs/evidence/maplibre-alignment/README.md。 */
const widths = {
  major: { fill: [[6,0],[8,1],[21,18]], casing: [[6,0.4],[7,0.7],[8,1.75],[21,22]] },
  secondary: { fill: [[7.5,0],[9,0.5],[21,13]], casing: [[9,1.5],[21,17]] },
  minor: { fill: [[14.5,0],[15,2.5],[21,18]], casing: [[13,0.5],[14,1],[15,4],[21,20]] },
  service: { fill: [[16.5,0],[17,2],[21,7.5]], casing: [[16,1],[17,4],[21,11]] },
  link: { fill: [[13.5,0],[14,1.5],[15,2.5],[21,11.5]], casing: [[13,1],[14,3],[15,4],[21,15]] },
} as const;
export type RoadProfile = keyof typeof widths;
export const roadWidth = (profile: RoadProfile, casing = false) => ({
  widthUnit: 'pixels' as const, widthBase: 1.2,
  widthStops: widths[profile][casing ? 'casing' : 'fill'],
});
