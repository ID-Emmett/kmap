import { describe, expect, it } from 'vitest';
import { syncInspectorValue } from '../src/inspectorSync.js';

describe('Inspector 控件回填', () => {
  it('同步全部控件时不排入 change 回调，用户操作保持一次派发', () => {
    const queue: (() => void)[] = []; let calls = 0;
    const editor = { value: '', dispatchChange() { queue.push(() => { calls++; }); }, setValue(value: unknown) { this.value = String(value); this.dispatchChange(); } };
    for (let n = 0; n < 1000; n++) syncInspectorValue(editor, n);
    expect(editor.value).toBe('999'); expect(queue).toHaveLength(0);
    editor.setValue('user'); expect(queue).toHaveLength(1); queue.shift()!(); expect(calls).toBe(1);
  });
  it('异常后恢复原有派发方法', () => {
    const dispatchChange = () => {}; const editor = { dispatchChange, setValue() { throw new Error('invalid'); } };
    expect(() => syncInspectorValue(editor, 0)).toThrow('invalid'); expect(editor.dispatchChange).toBe(dispatchChange);
  });
});
