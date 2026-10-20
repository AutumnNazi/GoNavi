/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { injectDownloadedFontFaces } from './faces';
import type { FontInstalled } from './types';

describe('downloaded font face injection', () => {
  it('writes unique families and does not invent a fallback family', () => {
    document.head.innerHTML = '';
    const installed: FontInstalled[] = [{
      family: 'GoNaviFont-go-mono',
      url: '/__gonavi/font-gallery/assets/deadbeef.ttf',
      entry: { id: 'go-mono', version: '1', kind: 'mono', family: 'Go Mono', names: { 'en-US': 'Go Mono' }, description: 'd', useCase: 'u',
        font: { path: 'assets/deadbeef.ttf', sha256: 'd'.repeat(64), sizeBytes: 1, mimeType: 'font/ttf' },
        preview: { path: 'assets/deadbeef.ttf', sha256: 'd'.repeat(64), sizeBytes: 1, mimeType: 'font/ttf' },
        attribution: 'a', sourceUrl: 'https://example.com/s', rightsStatus: 'approved',
        license: { id: 'bsd', name: 'BSD', url: 'https://example.com/l', notice: 'n', text: 't', nonCommercial: false } },
    }];
    injectDownloadedFontFaces(installed);
    const css = document.getElementById('gonavi-font-gallery-faces')?.textContent || '';
    expect(css).toContain('font-family:"GoNaviFont-go-mono"');
    expect(css).toContain('url("/__gonavi/font-gallery/assets/deadbeef.ttf")');
    expect(css).not.toContain('Menlo');
    expect(css).not.toContain('monospace');
  });
});
