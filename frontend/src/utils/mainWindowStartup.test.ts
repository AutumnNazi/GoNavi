import { describe, expect, it, vi } from 'vitest';

import {
  MAIN_WINDOW_FRONTEND_READY_EVENT,
  signalMainWindowFrontendReady,
  waitForMainWindowContentPaint,
} from './mainWindowStartup';

describe('mainWindowStartup', () => {
  it('resolves after two animation frames so the first HWND show is not an empty WebView', async () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    };
    const pending = waitForMainWindowContentPaint(requestFrame, () => undefined, 10_000);
    expect(frames).toHaveLength(1);
    frames[0](0);
    expect(frames).toHaveLength(2);
    frames[1](0);
    await pending;
  });

  it('emits the frontend-ready handshake and shows the hidden Windows window', () => {
    const eventsEmit = vi.fn();
    const windowShow = vi.fn();
    signalMainWindowFrontendReady({
      EventsEmit: eventsEmit,
      WindowShow: windowShow,
    });
    expect(eventsEmit).toHaveBeenCalledWith(MAIN_WINDOW_FRONTEND_READY_EVENT);
    expect(windowShow).toHaveBeenCalledTimes(1);
  });
});
