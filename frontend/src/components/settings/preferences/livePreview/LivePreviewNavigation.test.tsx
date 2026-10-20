// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LivePreviewNavigation } from './LivePreviewNavigation';

it.each(['rail', 'titlebar', 'below-toolbar'] as const)('keeps navigation actions interactive in %s placement', async placement => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const callbacks = { onToggle: vi.fn(), onSearch: vi.fn(), onLocate: vi.fn(), onScrollToTop: vi.fn(), onConnectionActions: vi.fn() };
  try {
    await act(async () => root.render(<LivePreviewNavigation placement={placement} collapsed={false} {...callbacks} />));
    const actions = [
      ['data-sidebar-collapse-trigger', callbacks.onToggle], ['data-sidebar-command-search-action', callbacks.onSearch],
      ['data-sidebar-locate-current-tab-action', callbacks.onLocate], ['data-sidebar-scroll-to-top-action', callbacks.onScrollToTop],
      ['data-sidebar-active-connection-actions', callbacks.onConnectionActions],
    ] as const;
    for (const [attribute, callback] of actions) {
      const button = container.querySelector<HTMLButtonElement>(`[${attribute}]`)!;
      expect(button.disabled).toBe(false);
      await act(async () => button.click());
      expect(callback).toHaveBeenCalledOnce();
    }
    await act(async () => root.render(<LivePreviewNavigation placement={placement} collapsed {...callbacks} />));
    expect(container.querySelector('[data-sidebar-collapse-trigger]')!.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('[data-sidebar-collapse-trigger]')).toHaveLength(1);
    expect(container.querySelector('.gn-v2-rail-explorer-actions') !== null).toBe(placement === 'rail');
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals();
  }
});
