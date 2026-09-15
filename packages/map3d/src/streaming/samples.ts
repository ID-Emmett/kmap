/** 有界环形统计保存实际观测值，序号用于连续采样去重。 */
export class Samples {
  private readonly buffer: number[] = [];
  private cursor = 0;
  private totalCount = 0;
  add(value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    this.buffer[this.cursor] = value;
    this.cursor = (this.cursor + 1) % 240;
    this.totalCount++;
  }
  snapshot() {
    const values = this.buffer.length < 240 ? [...this.buffer] : [...this.buffer.slice(this.cursor), ...this.buffer.slice(0, this.cursor)];
    const sorted = [...values].sort((a, b) => a - b);
    const percentile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? 0;
    return { totalCount: this.totalCount, count: values.length, values, last: values.at(-1) ?? 0, p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1) ?? 0, mean: values.reduce((a, b) => a + b, 0) / Math.max(1, values.length) };
  }
}
