// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewSurface } from './PreviewSurface';
import * as styleScope from './previewStyleScope';

let container: HTMLDivElement;
let root: Root;
let source: HTMLStyleElement;

async function flushMutations() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await vi.advanceTimersByTimeAsync(32); });
}

async function renderSurfaces(mode: 'classic' | 'navicat' = 'classic') {
  await act(async () => root.render(<>{Array.from({ length: 4 }, (_, index) =>
    <PreviewSurface key={index} mode={mode} label={'Preview ' + index}><button>Sample</button></PreviewSurface>,
  )}</>));
  await flushMutations();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame'] });
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  source = document.createElement('style');
  source.textContent = Array.from({ length: 2000 }, (_, i) => 'body .sample-' + i + ' { color: red; }').join('\n');
  document.head.append(source);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  source.remove();
  document.body.style.removeProperty('--preview-test-accent');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('preview stylesheet work during settings navigation', () => {
  it('serializes document styles once for four previews, not once per surface', async () => {
    const spy = vi.spyOn(styleScope, 'collectPreviewStyles');
    await renderSurfaces();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('mirrors theme variables and layout without recollecting or replacing CSS', async () => {
    const spy = vi.spyOn(styleScope, 'collectPreviewStyles');
    await renderSurfaces();
    spy.mockClear();
    const shadows = Array.from(container.querySelectorAll('.gn-live-preview-host'), host => host.shadowRoot!);
    const styles = shadows.map(shadow => shadow.querySelector('style')!);
    const texts = styles.map(style => style.firstChild);
    document.body.style.setProperty('--preview-test-accent', '#123456');
    await flushMutations();
    await renderSurfaces('navicat');
    for (const shadow of shadows) {
      const body = shadow.querySelector<HTMLElement>('[data-preview-body]')!;
      expect(body.style.getPropertyValue('--preview-test-accent')).toBe('#123456');
      expect(body.dataset.uiLayout).toBe('navicat');
    }
    expect(spy.mock.calls.length).toBe(0);
    styles.forEach((style, i) => expect(style.firstChild).toBe(texts[i]));
  });

  it('ignores unrelated head mutations and fans out a CSS update with one collection', async () => {
    const spy = vi.spyOn(styleScope, 'collectPreviewStyles');
    await renderSurfaces();
    spy.mockClear();
    const meta = document.createElement('meta');
    document.head.append(meta);
    await flushMutations();
    meta.remove();
    await flushMutations();
    expect(spy.mock.calls.length).toBe(0);
    source.textContent = 'body .updated { color: blue; }';
    await flushMutations();
    expect(spy).toHaveBeenCalledTimes(1);
    for (const host of container.querySelectorAll('.gn-live-preview-host')) {
      expect(host.shadowRoot!.querySelector('style')!.textContent).toContain('[data-preview-body] .updated');
    }
  });
});
