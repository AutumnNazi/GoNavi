// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { FontGalleryPanel } from './FontGalleryPanel';
import { fontEntry, fontInstalled } from './testFixtures';
import { loadDownloadedFont } from './faces';
import type { FontGalleryState, FontInstalled, FontPreviewed } from './types';

const api = vi.hoisted(() => ({ status: vi.fn(), refresh: vi.fn(), download: vi.fn(), preview: vi.fn(), remove: vi.fn(), cancel: vi.fn() }));
vi.mock('./adapter', () => ({ getFontGalleryAdapter: () => api }));
vi.mock('./faces', () => ({ loadDownloadedFont: vi.fn(async () => {}), injectDownloadedFontFaces: vi.fn(), notifyFontGalleryChanged: vi.fn() }));
vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'en-US' }) }));
let node: HTMLDivElement;
let root: Root;
let state: FontGalleryState;
const alpha = fontEntry('fixture-alpha');
const beta = fontEntry('fixture-beta');
const onEnable = vi.fn();
const button = (text: string) => Array.from(node.querySelectorAll('button')).find(b => b.textContent === text)!;
const render = async (open = true) => {
  await act(async () => root.render(<FontGalleryPanel open={open} onToggle={() => {}} installedFontFamilies={[]} onEnable={onEnable} />));
};
const click = async (label: string) => { await act(async () => button(label).click()); };
const select = async (id: string) => {
  const row = Array.from(node.querySelectorAll<HTMLButtonElement>('.gonavi-font-gallery-list button')).find(b => b.querySelector('strong')?.textContent === id)!;
  await act(async () => row.click());
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('FontFace', class { status = 'loaded'; async load() { return this; } });
  Object.defineProperty(document, 'fonts', { configurable: true, value: { add: vi.fn(), delete: vi.fn() } });
  node = document.createElement('div'); document.body.appendChild(node); root = createRoot(node);
  state = { catalog: { schemaVersion: 1, version: '1', entries: [alpha, beta] }, installed: [], stale: false };
  vi.clearAllMocks(); onEnable.mockReset();
  api.status.mockImplementation(async () => state); api.refresh.mockImplementation(async () => state);
  api.cancel.mockResolvedValue(undefined); api.remove.mockResolvedValue(undefined);
  vi.mocked(loadDownloadedFont).mockReset(); vi.mocked(loadDownloadedFont).mockResolvedValue(undefined);
});
afterEach(() => { act(() => root?.unmount()); node?.remove(); Reflect.deleteProperty(document, 'fonts'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('font library activation and preview lifecycle', () => {
  it('never enables an unavailable font after a failed download', async () => {
    api.download.mockRejectedValue(new Error('offline'));
    await render(); await select(alpha.id); await click('app.theme.font_family.gallery.download');
    expect(onEnable).not.toHaveBeenCalled();
    expect(node.textContent).toContain('app.theme.font_family.gallery.error.download_failed');
  });
  it('uses the verified injected alias immediately after the first download', async () => {
    const installed = fontInstalled(alpha);
    api.download.mockImplementation(async () => { state = { ...state, installed: [installed] }; return installed; });
    await render(); await select(alpha.id); await click('app.theme.font_family.gallery.download');
    expect(onEnable).toHaveBeenCalledWith('mono', installed.family);
  });
  it('removes the actually installed version when a newer catalog version exists', async () => {
    const installed = fontInstalled({ ...alpha, version: 'old' });
    state.installed = [installed];
    await render(); await select(alpha.id); await click('app.theme.font_family.gallery.remove');
    expect(api.remove).toHaveBeenCalledWith(alpha.id, 'old');
  });
  it('does not show a completed or late preview under another font entry', async () => {
    let resolve!: (value: FontPreviewed) => void;
    api.preview.mockReturnValue(new Promise<FontPreviewed>(done => { resolve = done; }));
    await render(); await select(alpha.id); await click('app.theme.font_family.gallery.preview');
    await select(beta.id);
    await act(async () => resolve({ entry: alpha, family: 'GoNaviFontPreview-' + alpha.id, url: '/preview.ttf' }));
    expect(node.querySelector('.gonavi-font-gallery-preview p')?.getAttribute('style')).toBeNull();
    expect(api.cancel).toHaveBeenCalled();
  });
  it('ignores an obsolete activation after moving to another font detail', async () => {
    state.installed = [fontInstalled(alpha), fontInstalled(beta)];
    let resolve!: () => void;
    vi.mocked(loadDownloadedFont).mockImplementation(item => item.entry.id === alpha.id
      ? new Promise<void>(done => { resolve = done; }) : Promise.resolve());
    await render(); await select(alpha.id); await click('app.theme.font_family.gallery.use');
    await select(beta.id); await click('app.theme.font_family.gallery.use');
    await act(async () => resolve());
    expect(onEnable).toHaveBeenCalledTimes(1);
    expect(onEnable).toHaveBeenCalledWith('mono', fontInstalled(beta).family);
  });

  it('cancels and invalidates a download when the library closes', async () => {
    let resolve!: (value: FontInstalled) => void;
    api.download.mockReturnValue(new Promise<FontInstalled>(done => { resolve = done; }));
    await render(); await select(alpha.id); await click('app.theme.font_family.gallery.download');
    await render(false);
    await act(async () => resolve(fontInstalled(alpha)));
    expect(onEnable).not.toHaveBeenCalled();
    expect(api.cancel).toHaveBeenCalled();
    await render(); await select(alpha.id);
    expect(button('app.theme.font_family.gallery.download').disabled).toBe(false);
  });
});
