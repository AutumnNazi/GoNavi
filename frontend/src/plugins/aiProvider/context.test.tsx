import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AIContextRing } from '../../components/ai/AIContextRing';
import { buildAIContextBreakdown } from '../../components/ai/aiContextBreakdown';
import { resolveEffectiveContextWindow, FALLBACK_CONTEXT_WINDOW } from '../../utils/aiChatRuntime';
import { UNKNOWN_PLUGIN_CONTEXT } from '../../components/ai/usePluginProviderModelCatalog';
const input = { reservedOutput: 0, workspaceBytes: 0, boundBytes: 0, draftText: '', history: { user: 0, assistant: 0, toolResults: 0, messageCount: 0 } };
describe('unavailable plugin context window', () => {
  it('never borrows builtin context or renders false percentages', () => {
    expect(resolveEffectiveContextWindow(UNKNOWN_PLUGIN_CONTEXT, 65536)).toBe(0);
    const breakdown = buildAIContextBreakdown({ ...input, windowSize: 0 });
    expect(breakdown.unavailable).toBe(true); expect(breakdown.pressure).toBe(0);
    const html = renderToStaticMarkup(<AIContextRing breakdown={breakdown} copy={(key) => key} />);
    expect(html).toContain('plugin.ai_provider.unavailable'); expect(html).not.toContain('<svg'); expect(html).not.toContain('NaN');
  });
  it('keeps builtin null fallback and valid zero-used context unchanged', () => {
    expect(resolveEffectiveContextWindow(null, 0)).toBe(FALLBACK_CONTEXT_WINDOW);
    const breakdown = buildAIContextBreakdown({ ...input, windowSize: 4096 }); expect(breakdown.unavailable).not.toBe(true); expect(breakdown.used).toBe(0);
  });
});
