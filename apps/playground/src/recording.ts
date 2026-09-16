/** 优先使用浏览器支持的 H.264 录制，实际编码格式随证据保存。 */
export function createMapRecorder(stream: MediaStream): MediaRecorder {
  const mimeType = ['video/mp4;codecs=avc1.640033', 'video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp8'].find(type => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error('当前浏览器缺少地图录像编码器。');
  return new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
}
