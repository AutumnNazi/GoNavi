// @vitest-environment jsdom
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BACKGROUND_IMAGE_STORAGE_KEY, useBackgroundImageStore } from '../../backgroundImageStore';
import BackgroundImageStyleHost from './BackgroundImageStyleHost';

const image = { name: 'background.jpg', dataUrl: 'data:image/jpeg;base64,/9j//9k=' };
let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  useBackgroundImageStore.setState({ image: null, builtinId: null, enabled: false, opacity: 15, positionX: 0, positionY: 0, previewPosition: null });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function mount() {
  const root = document.createElement('main');
  root.className = 'gn-v2-app-root';
  document.body.append(root);
  act(() => { renderer = create(<BackgroundImageStyleHost />); });
  return root;
}

describe('BackgroundImageStyleHost', () => {
  it('leaves default backgrounds untouched when no image is selected', () => {
    const root = mount();
    expect(root.hasAttribute('data-background-image')).toBe(false);
    expect(root.style.getPropertyValue('--gn-background-image')).toBe('');
  });

  it('applies the local image and updates its tint without changing theme opacity', () => {
    useBackgroundImageStore.setState({ image, enabled: true, opacity: 15 });
    const root = mount();
    expect(root.getAttribute('data-background-image')).toBe('true');
    expect(root.style.getPropertyValue('--gn-background-image')).toBe(`url("${image.dataUrl}")`);
    expect(root.style.getPropertyValue('--gn-background-tint')).toBe('85%');
    act(() => useBackgroundImageStore.setState({ opacity: 30 }));
    expect(root.style.getPropertyValue('--gn-background-tint')).toBe('70%');
    expect(document.body.style.getPropertyValue('--gn-window-opacity')).toBe('');
  });

  it('applies transient viewport offsets without replacing image data or moving the tint', () => {
    useBackgroundImageStore.setState({ image, enabled: true, positionX: 12, positionY: -34 });
    const root = mount();
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('12vw');
    expect(root.style.getPropertyValue('--gn-background-offset-y')).toBe('-34vh');
    const set = vi.spyOn(root.style, 'setProperty');
    act(() => useBackgroundImageStore.getState().previewPositionAt(25, -50));
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('25vw');
    expect(root.style.getPropertyValue('--gn-background-offset-y')).toBe('-50vh');
    expect(set.mock.calls.map(([name]) => name)).toEqual(['--gn-background-offset-x', '--gn-background-offset-y']);
    act(() => useBackgroundImageStore.getState().cancelPositionPreview());
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('12vw');
    act(() => useBackgroundImageStore.setState({ image: null }));
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('');
    expect(root.style.getPropertyValue('--gn-background-offset-y')).toBe('');
  });

  it('restores original surfaces when removed or unmounted', () => {
    useBackgroundImageStore.setState({ image, enabled: true });
    const root = mount();
    act(() => useBackgroundImageStore.setState({ image: null }));
    expect(root.hasAttribute('data-background-image')).toBe(false);
    expect(root.style.getPropertyValue('--gn-background-image')).toBe('');
    act(() => useBackgroundImageStore.setState({ image }));
    act(() => renderer?.unmount());
    expect(root.hasAttribute('data-background-image')).toBe(false);
    expect(root.style.getPropertyValue('--gn-background-tint')).toBe('');
  });

  it('synchronizes changes from other windows and removes the listener on unmount', () => {
    const originalReload = useBackgroundImageStore.getState().reload;
    const reload = vi.fn();
    useBackgroundImageStore.setState({ reload });
    try {
      mount();
      window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
      expect(reload).not.toHaveBeenCalled();
      window.dispatchEvent(new StorageEvent('storage', { key: BACKGROUND_IMAGE_STORAGE_KEY }));
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      expect(reload).toHaveBeenCalledTimes(2);
      act(() => renderer?.unmount());
      window.dispatchEvent(new StorageEvent('storage', { key: BACKGROUND_IMAGE_STORAGE_KEY }));
      expect(reload).toHaveBeenCalledTimes(2);
    } finally {
      useBackgroundImageStore.setState({ reload: originalReload });
    }
  });

  it('paints titlebar and toolbar surfaces with the same viewport-aligned workspace background', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/theme/backgroundImage.css'), 'utf8');
    const sharedRule = css.slice(0, css.indexOf('}') + 1);
    expect(sharedRule).toContain('.gn-v2-titlebar,');
    expect(sharedRule).toContain('.gn-titlebar-toolbar,');
    expect(sharedRule).toContain('.gn-v2-collapsed-sidebar-actions.is-below-toolbar,');
    expect(sharedRule).toContain('.ant-layout-content,');
    expect(sharedRule).toContain('.gn-v2-app-sider,');
    expect(sharedRule).toContain('.gn-monaco-surface,');
    expect(sharedRule).toContain('background-position: center, calc(50% + var(--gn-background-offset-x, 0vw)) calc(50% + var(--gn-background-offset-y, 0vh)) !important;');
    expect(sharedRule).toContain('background-size: cover, var(--gn-background-size, cover) !important;');
    expect(sharedRule).toContain('background-attachment: fixed, fixed !important;');
    expect(sharedRule).toContain('background-repeat: no-repeat, no-repeat !important;');
    expect(sharedRule).toContain('background-color: var(--gn-bg-panel-2) !important;');
    expect(sharedRule).not.toContain('transform');
    expect(sharedRule).not.toContain('.ant-btn');
    expect(sharedRule).not.toContain('--wails-draggable');
  });

  it('scopes images to workbench surfaces, supports both layouts, and never overlays text', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/theme/backgroundImage.css'), 'utf8');
    expect(css).toContain(".gn-v2-app-root[data-background-image='true']");
    expect(css).toContain('.gn-navicat-empty-workspace');
    expect(css).toContain('.gn-v2-empty-workbench');
    expect(css).toContain('.gn-monaco-surface');
    expect(css).toContain('background-attachment: fixed');
    expect(css).not.toContain('z-index');
    expect(css).not.toContain('pointer-events');
    expect(css).not.toContain('.ant-modal');
  });
});
