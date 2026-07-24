import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readComponent = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('close-tab shortcut portal guards', () => {
  it.each([
    './DataGridLegacyCellContextMenu.tsx',
    './DataGridShell.tsx',
    './Sidebar.tsx',
    './TableOverview.tsx',
    './RedisViewer.tsx',
  ])('blocks background close commands while the interactive portal is visible: %s', (path) => {
    const source = readComponent(path);
    expect(source).toContain('data-gonavi-close-shortcut-guard="true"');
    expect(source).toContain('data-gonavi-close-shortcut-blocks-background="true"');
  });

  it.each([
    './FloatingQueryResultWindows.tsx',
    './FloatingWorkbenchWindows.tsx',
    './FloatingAIChatWindow.tsx',
    './resultDiff/ResultDiffPanel.tsx',
  ])('blocks routing after explicit detached-window interaction without global blocking: %s', (path) => {
    const source = readComponent(path);
    expect(source).toContain('data-gonavi-close-shortcut-guard="true"');
    expect(source).toContain('data-gonavi-close-shortcut-scope="blocked"');
  });
});
