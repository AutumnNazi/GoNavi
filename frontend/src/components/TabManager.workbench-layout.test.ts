import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const themeSource = readFileSync(new URL('../v2-theme.css', import.meta.url), 'utf8');
const tabManagerSource = readFileSync(new URL('./TabManager.tsx', import.meta.url), 'utf8');

const readRule = (selector: string): string => {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = themeSource.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`, 's'));
  expect(match, `missing CSS rule for ${selector}`).not.toBeNull();
  return match?.groups?.body ?? '';
};

describe('empty workbench layout', () => {
  it('keeps the start page in a single compact content column', () => {
    const workbenchRule = readRule('body[data-ui-version="v2"] .gn-v2-empty-workbench');

    expect(workbenchRule).toContain('display: flex;');
    expect(workbenchRule).toContain('flex-direction: column;');
    expect(workbenchRule).not.toContain('grid-template-columns');
  });

  it('removes the oversized quick-workflow side panel', () => {
    expect(themeSource).not.toContain('gn-v2-empty-panel');
    expect(themeSource).not.toContain('gn-v2-panel-heading');
  });
});

describe('workbench tab native detach drag', () => {
  it('treats a captured native pointercancel as a possible cross-window release', () => {
    expect(tabManagerSource).toContain(
      "windowTarget.addEventListener('pointercancel', recordTerminalPointer, true)",
    );
    expect(tabManagerSource).toContain('terminalPointer: session?.terminalPointer');
    expect(tabManagerSource).toContain('shouldDetachAfterNativePointerCancel(release');
    expect(tabManagerSource).toContain('const hadActiveSession = detachDragSessionRef.current !== null;');
    expect(tabManagerSource).toContain('if (hadActiveSession) {\n      dispatchDndPointerCancel();');
  });
});
