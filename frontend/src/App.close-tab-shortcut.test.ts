import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appSource = readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');
const modalSource = readFileSync(
  new URL('./components/common/ResizableDraggableModal.tsx', import.meta.url),
  'utf8',
);
const floatingResultSource = readFileSync(
  new URL('./components/FloatingQueryResultWindows.tsx', import.meta.url),
  'utf8',
);

describe('App close-tab shortcut routing', () => {
  it('tracks only explicit workspace, result, and blocked interaction scopes', () => {
    expect(appSource).toContain("const closeShortcutScopeRef = useRef<CloseShortcutScope>('workspace');");
    expect(appSource).toContain('resolveCloseShortcutScopeFromTarget(event.target)');
    expect(appSource).toContain("document.addEventListener('pointerdown', handleExplicitCloseShortcutScope, true);");
    expect(appSource).toContain("document.addEventListener('focusin', handleExplicitCloseShortcutScope, true);");
    expect(appSource).toContain('data-gonavi-close-shortcut-scope="workspace"');
  });

  it('gives shortcut recording priority over every global action', () => {
    const recorderGuardIndex = appSource.indexOf('if (capturingShortcutAction) {');
    const closeDecisionIndex = appSource.indexOf('const closeDecision = resolveCloseShortcutKeydownDecision({');
    expect(recorderGuardIndex).toBeGreaterThan(-1);
    expect(closeDecisionIndex).toBeGreaterThan(recorderGuardIndex);
    expect(appSource).toContain('setGlobalShortcutCaptureActive(Boolean(capturingShortcutAction));');
  });

  it('uses a single close decision before dispatching exactly one scoped command', () => {
    expect(appSource).toContain('interactionBlocked: isCloseShortcutInteractionBlocked(event.target, document)');
    expect(appSource).toContain("if (closeDecision.kind === 'consume') {");
    expect(appSource).toContain('event.stopImmediatePropagation();');
    expect(appSource).toContain("if (closeShortcutScopeRef.current === 'workspace') {");
    expect(appSource).toContain('dispatchCloseActiveWorkspaceTab();');
    expect(appSource).toContain("} else if (closeShortcutScopeRef.current === 'result') {");
    expect(appSource).toContain('const targetTabId = resolveDockedActiveTabId(');
    expect(appSource).toContain('const outcome = dispatchCloseActiveResultTab(targetTabId);');
  });

  it('enters blocked synchronously when the log tab hides the result area', () => {
    const dispatchIndex = appSource.indexOf('const outcome = dispatchCloseActiveResultTab(targetTabId);');
    const hiddenIndex = appSource.indexOf("if (outcome === 'hidden') {", dispatchIndex);
    const blockedIndex = appSource.indexOf("closeShortcutScopeRef.current = 'blocked';", hiddenIndex);
    expect(dispatchIndex).toBeGreaterThan(-1);
    expect(hiddenIndex).toBeGreaterThan(dispatchIndex);
    expect(blockedIndex).toBeGreaterThan(hiddenIndex);
  });

  it('does not let the close router steal a migrated shortcut from its prior owner', () => {
    expect(appSource).toContain("const delegatedAction = closeDecision.kind === 'delegate'");
    expect(appSource).toContain('if (delegatedAction && action !== delegatedAction) {');
    expect(appSource).toContain("if (action === 'closeActiveTab') {");
  });
});

describe('close shortcut interaction guards', () => {
  it('marks active reusable modals as background blockers', () => {
    expect(modalSource).toContain("data-gonavi-close-shortcut-guard={active ? 'true' : undefined}");
    expect(modalSource).toContain("data-gonavi-close-shortcut-blocks-background={active ? 'true' : undefined}");
    expect(modalSource).toContain('data-gonavi-close-shortcut-blocks-background="true"');
  });

  it('marks detached result windows as blocked without globally blocking their existence', () => {
    expect(floatingResultSource).toContain('data-gonavi-close-shortcut-guard="true"');
    expect(floatingResultSource).toContain('data-gonavi-close-shortcut-scope="blocked"');
    expect(floatingResultSource).not.toContain('data-gonavi-close-shortcut-blocks-background="true"');
  });
});
