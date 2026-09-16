/** 项目数量与阶段预算；来源和验收见行业瓦片研究报告。 */
export const TILE_LIMITS = Object.freeze({
  visible: 128, entries: 256, predicted: 32, fallbackRequests: 8,
  network: 12, workers: 4, decoded: 12, uploads: 8,
  requestBytes: 16 * 1048576, buildBytes: 8 * 1048576,
  uploadBytes: 4 * 1048576, uploadMs: 1.25,
  cpuBytes: 256 * 1048576, gpuBytes: 256 * 1048576,
});
