// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TabManager from './TabManager';
import { useStore } from '../store';

const WORKBENCH_SELECTOR = '.gn-v2-tab-workbench';
const originalAppearance = useStore.getState().appearance;

const readWorkbench = () => {
  const node = document.querySelector<HTMLElement>(WORKBENCH_SELECTOR);
  if (!node) throw new Error('tab workbench was not rendered');
  return node;
};

describe('TabManager tab appearance attributes', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    useStore.setState({ appearance: originalAppearance });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<TabManager />));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    useStore.setState({ appearance: originalAppearance });
    vi.unstubAllGlobals();
  });

  it('exposes the persisted appearance style and close position on the workbench root', () => {
    expect(readWorkbench().getAttribute('data-tab-appearance')).toBe('card');
    expect(readWorkbench().getAttribute('data-tab-close-position')).toBe('right');
  });

  it('follows the workspace appearance settings from the store', async () => {
    await act(async () => {
      useStore.getState().setAppearance({ tabAppearanceStyle: 'pill', tabCloseButtonPosition: 'left' });
    });
    expect(readWorkbench().getAttribute('data-tab-appearance')).toBe('pill');
    expect(readWorkbench().getAttribute('data-tab-close-position')).toBe('left');

    await act(async () => {
      useStore.getState().setAppearance({ tabAppearanceStyle: 'underline', tabCloseButtonPosition: 'right' });
    });
    expect(readWorkbench().getAttribute('data-tab-appearance')).toBe('underline');
    expect(readWorkbench().getAttribute('data-tab-close-position')).toBe('right');
  });

  it('falls back to card/right when the persisted values are dirty', async () => {
    await act(async () => {
      useStore.setState({
        appearance: {
          ...useStore.getState().appearance,
          tabAppearanceStyle: 'menu' as never,
          tabCloseButtonPosition: 'top' as never,
        },
      });
    });

    expect(readWorkbench().getAttribute('data-tab-appearance')).toBe('card');
    expect(readWorkbench().getAttribute('data-tab-close-position')).toBe('right');
  });
});
