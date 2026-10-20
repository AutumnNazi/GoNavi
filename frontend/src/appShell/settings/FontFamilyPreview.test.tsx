// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ConfigProvider, theme } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FontFamilyPreview } from './FontFamilyPreview';
import zhCN from '../../../../shared/i18n/zh-CN.json';

const t = (key: string): string => (zhCN as Record<string, string>)[key] ?? key;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
const render = (kind: 'ui' | 'mono', family = '"Preview Font", monospace', dark = false) => {
  act(() => root.render(<ConfigProvider theme={{ algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm }}>
    <FontFamilyPreview kind={kind} family={family} name="Preview Font" t={t} />
  </ConfigProvider>));
};

describe('font specimen preview', () => {
  it('separates interface title, body and character samples using the selected family', () => {
    render('ui');
    expect(container.querySelector('.gonavi-font-specimen-title')?.textContent).toBe(t('app.theme.font_family.specimen.ui_title'));
    expect(container.querySelector('.gonavi-font-specimen-description')?.textContent).toBe(t('app.theme.font_family.specimen.ui_description'));
    expect(container.querySelector('.gonavi-font-specimen-character-sample')?.textContent).toContain('0123456789');
    expect(container.querySelector<HTMLElement>('.gonavi-font-preview-sample')?.style.fontFamily).toBe('"Preview Font", monospace');
    expect(container.querySelector('.gonavi-font-specimen-glyph')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('highlights SQL without changing the text or duplicating string tokens', () => {
    render('mono');
    const lines = Array.from(container.querySelectorAll('.gonavi-font-specimen-line code')).map(node => node.textContent);
    expect(lines.join('\n')).toBe(t('app.theme.font_family.specimen.sql'));
    expect(container.querySelectorAll('.is-string')).toHaveLength(1);
    expect(container.querySelector('.is-string')?.textContent).toBe("'active'");
    expect(container.querySelectorAll('.is-keyword')).toHaveLength(7);
    expect(container.querySelectorAll('.gonavi-font-specimen-line-number')).toHaveLength(3);
    for (const number of container.querySelectorAll('.gonavi-font-specimen-line-number')) {
      expect(number.getAttribute('aria-hidden')).toBe('true');
    }
  });

  it('uses current theme tokens instead of hard-coded light backgrounds', () => {
    render('mono');
    const light = container.querySelector<HTMLElement>('.gonavi-font-preview')!.style.getPropertyValue('--font-preview-bg');
    render('mono', 'monospace', true);
    const dark = container.querySelector<HTMLElement>('.gonavi-font-preview')!.style.getPropertyValue('--font-preview-bg');
    expect(light).not.toBe(dark);
    expect(dark).not.toBe('');
  });

  it('updates the specimen without fetching or changing the selected font', () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    render('mono');
    render('mono', '"New Font", monospace');
    expect(container.querySelector<HTMLElement>('.gonavi-font-preview-sample')?.style.fontFamily).toBe('"New Font", monospace');
    expect(fetch).not.toHaveBeenCalled();
  });
});
