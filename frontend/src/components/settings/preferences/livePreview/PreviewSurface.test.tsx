// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { PreviewSurface } from './PreviewSurface';

it('synchronizes theme variables while keeping preview layout and focus scrolling isolated', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  const previous = document.body.getAttribute('data-ui-layout');
  const previousAccent = document.body.style.getPropertyValue('--gn-accent');
  document.body.setAttribute('data-ui-layout', 'classic');
  document.body.style.setProperty('--gn-accent', '#664488');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<PreviewSurface mode="navicat" label="Preview"><button>Sample</button></PreviewSurface>));
    const host = container.querySelector('.gn-live-preview-host') as HTMLElement;
    const preview = host.shadowRoot!.querySelector('[data-preview-body]') as HTMLElement;
    expect(preview.getAttribute('data-ui-layout')).toBe('navicat');
    expect(document.body.getAttribute('data-ui-layout')).toBe('classic');
    expect(preview.style.getPropertyValue('--gn-accent')).toBe('#664488');
    document.body.style.setProperty('--gn-accent', '#cc7700');
    await vi.waitFor(() => expect(preview.style.getPropertyValue('--gn-accent')).toBe('#cc7700'));
    host.scrollTop = 110;
    await act(async () => root.render(<PreviewSurface mode="classic" label="Preview"><button>Sample</button></PreviewSurface>));
    expect(host.scrollTop).toBe(0);
    expect(document.body.getAttribute('data-ui-layout')).toBe('classic');
  } finally {
    await act(async () => root.unmount()); container.remove();
    if (previous === null) document.body.removeAttribute('data-ui-layout'); else document.body.setAttribute('data-ui-layout', previous);
    if (previousAccent) document.body.style.setProperty('--gn-accent', previousAccent); else document.body.style.removeProperty('--gn-accent');
    vi.unstubAllGlobals();
  }
});
