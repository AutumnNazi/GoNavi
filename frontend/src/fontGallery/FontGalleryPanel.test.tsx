/** @vitest-environment jsdom */
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontGalleryPanel } from './FontGalleryPanel';
import { FontGalleryError } from './types';

vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key, language: 'zh-CN' }) }));
const preview = vi.fn();
vi.mock('./adapter', () => ({
  getFontGalleryAdapter: () => ({
    status: async () => ({ catalog: { schemaVersion: 1, version: '1', entries: [{
      id: 'go-mono', version: '1', kind: 'mono', family: 'Go Mono', names: { 'zh-CN': 'Go Mono' },
      description: 'desc', useCase: 'sql', font: { path: 'assets/' + 'a'.repeat(64) + '.ttf', sha256: 'a'.repeat(64), sizeBytes: 10, mimeType: 'font/ttf' },
      preview: { path: 'assets/' + 'a'.repeat(64) + '.ttf', sha256: 'a'.repeat(64), sizeBytes: 10, mimeType: 'font/ttf' },
      attribution: 'a', sourceUrl: 'https://example.com/s', rightsStatus: 'approved',
      license: { id: 'bsd', name: 'BSD', url: 'https://example.com/l', notice: 'n', text: 't', nonCommercial: false },
    }] }, installed: [], stale: false }),
    refresh: async () => ({ catalog: { schemaVersion: 1, version: '1', entries: [{
      id: 'go-mono', version: '1', kind: 'mono', family: 'Go Mono', names: { 'zh-CN': 'Go Mono' },
      description: 'desc', useCase: 'sql', font: { path: 'assets/' + 'a'.repeat(64) + '.ttf', sha256: 'a'.repeat(64), sizeBytes: 10, mimeType: 'font/ttf' },
      preview: { path: 'assets/' + 'a'.repeat(64) + '.ttf', sha256: 'a'.repeat(64), sizeBytes: 10, mimeType: 'font/ttf' },
      attribution: 'a', sourceUrl: 'https://example.com/s', rightsStatus: 'approved',
      license: { id: 'bsd', name: 'BSD', url: 'https://example.com/l', notice: 'n', text: 't', nonCommercial: false },
    }] }, installed: [], stale: false }),
    preview,
    download: vi.fn(), remove: vi.fn(), resolve: vi.fn(), cancel: vi.fn(), dispose: vi.fn(),
  }),
}));

describe('FontGalleryPanel preview', () => {
  let container: HTMLDivElement;
  let root: Root;
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    preview.mockReset();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it('does not repeat system-installed recommendations in the browse list', async () => {
    await act(async () => {
      root.render(<FontGalleryPanel open onToggle={() => undefined}
        installedFontFamilies={[{ family: 'JetBrains Mono' }]} onEnable={() => undefined} />);
    });
    const list = container.querySelector('.gonavi-font-gallery-list')!;
    expect(list.textContent).not.toContain('JetBrains Mono');
    expect(list.textContent).toContain('Fira Code');
    expect(preview).not.toHaveBeenCalled();
  });

  it('keeps the selector-free catalog and reports a failed preview without applying a fallback family', async () => {
    preview.mockRejectedValue(new FontGalleryError('preview_failed'));
    await act(async () => {
      root.render(<FontGalleryPanel open onToggle={() => undefined} installedFontFamilies={[]} onEnable={() => undefined} />);
    });
    expect(container.textContent).toContain('app.theme.font_family.gallery.hide');
    expect(container.textContent).toContain('Go Mono');
    const goMono = Array.from(container.querySelectorAll('button')).find(button => button.textContent?.includes('Go Mono'));
    expect(goMono).toBeTruthy();
    await act(async () => { goMono!.click(); });
    const previewButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent === 'app.theme.font_family.gallery.preview');
    expect(previewButton).toBeTruthy();
    await act(async () => { previewButton!.click(); });
    expect(container.textContent).toContain('app.theme.font_family.gallery.error.preview_failed');
    expect(container.querySelector('.gonavi-font-gallery-preview p')?.getAttribute('style') || '').not.toContain('Menlo');
  });
});
