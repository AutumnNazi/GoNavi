// @vitest-environment jsdom
import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '../../../../store';
import { DEFAULT_APPEARANCE } from '../../../../store/storeConstants';
import { LivePreviewTitleBar } from './LivePreviewTitleBar';
import { collectPreviewStyles } from './previewStyleScope';

const inlineCss = readFileSync('src/components/titlebar/titleBarActionRow.css', 'utf8');
const toolbarCss = readFileSync('src/components/titlebar/titleBarToolBar.css', 'utf8');

let container: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  useStore.setState({ appearance: { ...DEFAULT_APPEARANCE, titlebarActionsPlacement: 'titlebar' } });
  container = document.createElement('div');
  container.setAttribute('data-preview-body', '');
  container.setAttribute('data-ui-version', 'v2');
  document.body.append(container);
  root = createRoot(container);
  // Apply the production rules through the same selector scoping used by the live preview.
  const sourceStyle = document.createElement('style');
  sourceStyle.textContent = `${inlineCss}\n${toolbarCss}`;
  document.head.append(sourceStyle);
  style = document.createElement('style');
  style.textContent = collectPreviewStyles(document);
  sourceStyle.remove();
  document.head.append(style);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove(); style.remove(); vi.unstubAllGlobals();
});

async function render(mode: 'classic' | 'navicat' = 'classic', overrides: Partial<React.ComponentProps<typeof LivePreviewTitleBar>> = {}) {
  const onNewConnection = vi.fn();
  const onNewQuery = vi.fn();
  await act(async () => root.render(<LivePreviewTitleBar mode={mode} onNewConnection={onNewConnection}
    onNewQuery={onNewQuery} onLocalAction={vi.fn()} {...overrides} />));
  return { onNewConnection, onNewQuery };
}

describe('live preview titlebar styling', () => {
  it.each(['text', 'icon', 'icon-text'] as const)('applies real inline icon and label rules in %s mode', async display => {
    useStore.setState({ appearance: { ...useStore.getState().appearance, titlebarActionsDisplay: display } });
    await render();
    const icons = container.querySelectorAll('.gn-titlebar-toolbar-item-icon');
    expect(icons.length).toBe(5);
    for (const icon of icons) {
      expect(getComputedStyle(icon).display).toBe(display === 'text' ? 'none' : 'inline-flex');
      if (display !== 'text') {
        expect(getComputedStyle(icon).width).not.toBe('');
        expect(getComputedStyle(icon.querySelector('svg')!).width).toBe('100%');
      }
    }
    const label = container.querySelector('.gn-titlebar-toolbar-item-label.has-short-label')!;
    const shortLabel = container.querySelector('.gn-titlebar-toolbar-item-short-label')!;
    expect(getComputedStyle(label).display === 'none').toBe(display !== 'text');
    expect(getComputedStyle(shortLabel).display).toBe(display === 'icon-text' ? 'inline' : 'none');
  });

  it.each(['classic', 'navicat'] as const)('keeps the %s standalone toolbar icons sized', async mode => {
    useStore.setState({ appearance: { ...useStore.getState().appearance,
      titlebarActionsPlacement: 'toolbar' } });
    await render(mode);
    expect(container.querySelector('.gonavi-titlebar-inline-actions')).toBeNull();
    for (const icon of container.querySelectorAll('.gn-titlebar-toolbar-item-icon')) {
      expect(getComputedStyle(icon).width).toBe('var(--gn-titlebar-toolbar-icon-size)');
      expect(getComputedStyle(icon.querySelector('svg')!).width).toBe('100%');
    }
  });

  it('previews Navicat inline actions independently of the saved toolbar placement', async () => {
    useStore.setState({ appearance: { ...useStore.getState().appearance, titlebarActionsPlacement: 'toolbar' } });
    await render('navicat', { placement: 'titlebar', display: 'icon' });
    expect(container.querySelector('.gonavi-titlebar-inline-actions')).not.toBeNull();
    for (const icon of container.querySelectorAll('.gonavi-titlebar-inline-actions .gn-titlebar-toolbar-item-icon')) {
      expect(getComputedStyle(icon).display).toBe('inline-flex');
      expect(getComputedStyle(icon.querySelector('svg')!).width).toBe('100%');
    }
    expect(useStore.getState().appearance.titlebarActionsPlacement).toBe('toolbar');
    expect(container.querySelector('[data-gonavi-workbench-object-actions]')).not.toBeNull();
  });

  it('uses local callbacks and does not change the active appearance', async () => {
    const appearance = useStore.getState().appearance;
    const callbacks = await render();
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-gonavi-create-connection-action]')!.click();
      container.querySelector<HTMLButtonElement>('[data-gonavi-new-query-action]')!.click();
    });
    expect(callbacks.onNewConnection).toHaveBeenCalledOnce();
    expect(callbacks.onNewQuery).toHaveBeenCalledOnce();
    expect(useStore.getState().appearance).toBe(appearance);
  });
});
