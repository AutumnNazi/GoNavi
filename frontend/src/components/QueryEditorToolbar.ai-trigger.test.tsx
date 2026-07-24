import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./QueryEditorToolbar.tsx', import.meta.url), 'utf8');

describe('QueryEditorToolbar AI trigger affordance', () => {
  it('keeps a direct toolbar trigger for inline AI completion', () => {
    expect(source).toContain('onMouseDown={onCaptureEditorCursorPosition}');
    expect(source).toContain('onClick={onTriggerSqlAiCompletion}');
    expect(source).toContain('triggerSqlAiCompletionLabel');
    expect(source).toContain('const aiMoreTitle');
    expect(source).toMatch(/aria-label=\{aiMoreTitle\}[\s\S]*?onMouseDown=\{onCaptureEditorCursorPosition\}/);
  });

  it('keeps the secondary AI dropdown for other actions', () => {
    expect(source).toContain('icon={<DownOutlined />}');
    expect(source).toContain('menu={{ items: aiMenuItems }}');
    expect(source).toContain('title={isV2Ui ? aiMoreTitle : undefined}');
  });
});
