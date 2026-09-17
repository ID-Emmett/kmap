export interface InspectorValue { setValue(value: unknown): unknown; dispatchChange(): void }

/** Inspector 的 setValue 会派发 change；模型回填期间只同步控件，保留用户事件回路。 */
export function syncInspectorValue(editor: InspectorValue, value: unknown): void {
  const dispatch = editor.dispatchChange;
  editor.dispatchChange = () => {};
  try { editor.setValue(value); } finally { editor.dispatchChange = dispatch; }
}
