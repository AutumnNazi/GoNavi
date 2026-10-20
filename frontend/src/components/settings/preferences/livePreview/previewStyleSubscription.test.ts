// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subscribePreviewStyles } from './previewStyleSubscription';
import * as styleScope from './previewStyleScope';

const cleanups: Array<() => void> = [];
let source: HTMLStyleElement;
async function flush() {
  await Promise.resolve();
  await vi.advanceTimersByTimeAsync(32);
}
function subscribe(listener = vi.fn()) {
  const cleanup = subscribePreviewStyles(document, listener);
  cleanups.push(cleanup);
  return { listener, cleanup };
}
beforeEach(() => {
  vi.useFakeTimers();
  source = document.createElement('style');
  source.textContent = 'body .first { color: red; }';
  document.head.append(source);
});
afterEach(() => {
  cleanups.splice(0).forEach(cleanup => cleanup());
  source.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('coalesces stylesheet mutation bursts and does not deliver unchanged CSS', async () => {
  const spy = vi.spyOn(styleScope, 'collectPreviewStyles');
  const { listener } = subscribe();
  subscribe();
  expect(spy).toHaveBeenCalledTimes(1);
  source.textContent = 'body .next { color: green; }';
  source.textContent = 'body .last { color: blue; }';
  await flush();
  expect(spy).toHaveBeenCalledTimes(2);
  expect(listener).toHaveBeenCalledTimes(2);
  source.textContent = source.textContent;
  await flush();
  expect(listener).toHaveBeenCalledTimes(2);
});

it('cancels pending work on the last unsubscribe and reads fresh CSS on revisit', async () => {
  const spy = vi.spyOn(styleScope, 'collectPreviewStyles');
  const first = subscribe();
  source.textContent = 'body .changed { color: green; }';
  await Promise.resolve();
  first.cleanup();
  await flush();
  expect(spy).toHaveBeenCalledTimes(1);
  const second = subscribe();
  expect(spy).toHaveBeenCalledTimes(2);
  expect(second.listener).toHaveBeenLastCalledWith(expect.stringContaining('.changed'));
  second.listener.mockClear();
  source.textContent = 'body .again { color: purple; }';
  await flush();
  expect(first.listener).toHaveBeenCalledTimes(1);
  expect(second.listener).toHaveBeenCalledOnce();
});

it('keeps remaining subscribers live when one surface unmounts', async () => {
  const first = subscribe();
  const second = subscribe();
  first.cleanup();
  source.remove();
  await flush();
  expect(first.listener).toHaveBeenCalledTimes(1);
  expect(second.listener).toHaveBeenCalledTimes(2);
  expect(second.listener.mock.calls[1][0]).not.toContain('.first');
});

it('invalidates linked styles on load and metadata changes', async () => {
  const spy = vi.spyOn(styleScope, 'collectPreviewStyles');
  subscribe();
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  document.head.append(link);
  try {
    await flush();
    spy.mockClear();
    link.dispatchEvent(new Event('load'));
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    link.media = 'print';
    await flush();
    expect(spy).toHaveBeenCalledTimes(2);
    link.rel = 'preload';
    await flush();
    expect(spy).toHaveBeenCalledTimes(3);
  } finally { link.remove(); }
});
