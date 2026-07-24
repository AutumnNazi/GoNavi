import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appSource = readFileSync(
  fileURLToPath(new globalThis.URL('./App.tsx', import.meta.url)),
  'utf8',
);
const aiPanelBoundarySource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/ai/AIPanelErrorBoundary.tsx', import.meta.url)),
  'utf8',
);
const floatingAIWindowSource = readFileSync(
  fileURLToPath(new globalThis.URL('./components/FloatingAIChatWindow.tsx', import.meta.url)),
  'utf8',
);

describe('AI panel lazy-load guard', () => {
  it('keeps AI panel failures scoped to the panel area with retry support', () => {
    expect(appSource).not.toContain("import AIChatPanel from './components/AIChatPanel';");
    expect(appSource).not.toContain("import { AISettingsContent } from './components/AISettingsModal';");
    expect(appSource).toContain("const createLazyAIChatPanel = () => React.lazy(() => import('./components/AIChatPanel'));");
    expect(appSource).toContain("const module = await import('./components/AISettingsModal');");
    expect(floatingAIWindowSource).not.toContain("import AIChatPanel from './AIChatPanel';");
    expect(floatingAIWindowSource).toContain("const createLazyAIChatPanel = () => React.lazy(() => import('./AIChatPanel'));");
    expect(floatingAIWindowSource).toContain('const LazyAIChatPanel = useMemo(createLazyAIChatPanel, [renderNonce]);');
    expect(floatingAIWindowSource).toContain('<React.Suspense');
    expect(appSource).toContain("import AIPanelErrorBoundary from './components/ai/AIPanelErrorBoundary';");
    expect(aiPanelBoundarySource).toContain('class AIPanelErrorBoundary extends React.Component');
    expect(appSource).toContain('<AIPanelErrorBoundary');
    expect(appSource).toContain('key={aiPanelRenderNonce}');
    expect(appSource).toContain('key={`ai-settings-${aiSettingsRenderNonce}`}');
    expect(appSource).toContain("t('app.ai_panel.error.title')");
    expect(appSource).toContain("t('app.ai_panel.action.reload')");
    expect(appSource).toContain('setAiPanelRenderNonce((current) => current + 1)');
    expect(appSource).toContain('setAiSettingsRenderNonce((current) => current + 1)');
    expect(appSource).toContain('const LazyAIChatPanel = useMemo(createLazyAIChatPanel, [aiPanelRenderNonce]);');
    expect(appSource).toContain('const LazyAISettingsContent = useMemo(createLazyAISettingsContent, [aiSettingsRenderNonce]);');
    expect(appSource).toContain('<Button size="small" onClick={handleRetryAISettingsRender}>');
    expect(appSource).not.toContain('const LazyAISettingsContent = useMemo(createLazyAISettingsContent, [aiPanelRenderNonce]);');
    expect(appSource).toContain('<LazyAIChatPanel');
    expect(appSource).toContain('<LazyAISettingsContent');
    expect(appSource).toContain('<React.Suspense');
    expect(appSource).not.toContain('const loadAIChatPanelModule = async (retryNonce: number) => {');
  });
});
