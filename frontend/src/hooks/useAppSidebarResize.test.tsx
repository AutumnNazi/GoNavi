import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppSidebarResize } from './useAppSidebarResize';

type Listener = (event: any) => void;

class FakeEventTarget {
  private listeners = new Map<string, Set<Listener>>();

  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? new Set<Listener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: Listener) {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: any = {}) {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }

  listenerCount(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
}

class FakeHTMLElement {
  getBoundingClientRect() {
    return { right: 240, width: 240 };
  }
}

describe('useAppSidebarResize interaction cleanup', () => {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const previousHTMLElementDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'HTMLElement');
  const previousRequestAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'requestAnimationFrame');
  const previousCancelAnimationFrameDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');

  let renderer: ReactTestRenderer | null = null;
  let resize: ReturnType<typeof useAppSidebarResize> | null = null;
  let fakeWindow: FakeEventTarget & { getComputedStyle: () => { minWidth: string; maxWidth: string }; innerWidth: number };
  let fakeDocument: FakeEventTarget & {
    body: {
      style: {
        cursor: string;
        userSelect: string;
        webkitUserSelect: string;
      };
    };
  };
  let ghost: { style: { display: string; left: string } };
  let scheduledFrames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let setSidebarWidth: ReturnType<typeof vi.fn>;

  const Harness = () => {
    resize = useAppSidebarResize({
      effectiveUiScale: 1,
      setSidebarWidth,
      sidebarWidth: 240,
    });
    return null;
  };

  const beginResize = () => {
    act(() => {
      resize?.handleSidebarMouseDown({
        button: 0,
        clientX: 200,
        preventDefault: vi.fn(),
        stopPropagation: vi.fn(),
      } as unknown as React.MouseEvent);
    });
  };

  beforeEach(() => {
    scheduledFrames = new Map();
    nextFrameId = 1;
    setSidebarWidth = vi.fn();
    fakeWindow = Object.assign(new FakeEventTarget(), {
      getComputedStyle: () => ({ minWidth: '180px', maxWidth: '600px' }),
      innerWidth: 1200,
    });
    fakeDocument = Object.assign(new FakeEventTarget(), {
      body: {
        style: {
          cursor: 'wait',
          userSelect: 'text',
          webkitUserSelect: 'auto',
        },
      },
    });
    ghost = { style: { display: 'none', left: '' } };

    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });
    Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: FakeHTMLElement });
    Object.defineProperty(globalThis, 'requestAnimationFrame', {
      configurable: true,
      value: vi.fn((callback: FrameRequestCallback) => {
        const frameId = nextFrameId++;
        scheduledFrames.set(frameId, callback);
        return frameId;
      }),
    });
    Object.defineProperty(globalThis, 'cancelAnimationFrame', {
      configurable: true,
      value: vi.fn((frameId: number) => scheduledFrames.delete(frameId)),
    });

    act(() => {
      renderer = create(<Harness />);
    });
    (resize!.siderRef as React.MutableRefObject<any>).current = new FakeHTMLElement();
    (resize!.ghostRef as React.MutableRefObject<any>).current = ghost;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    resize = null;

    for (const [name, descriptor] of [
      ['window', previousWindowDescriptor],
      ['document', previousDocumentDescriptor],
      ['HTMLElement', previousHTMLElementDescriptor],
      ['requestAnimationFrame', previousRequestAnimationFrameDescriptor],
      ['cancelAnimationFrame', previousCancelAnimationFrameDescriptor],
    ] as const) {
      if (descriptor) {
        Object.defineProperty(globalThis, name, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, name);
      }
    }
  });

  it('restores the exact body styles and removes listeners when the window blurs', () => {
    beginResize();

    expect(fakeDocument.body.style).toEqual({
      cursor: 'col-resize',
      userSelect: 'none',
      webkitUserSelect: 'none',
    });
    expect(ghost.style.display).toBe('block');
    expect(fakeWindow.listenerCount('blur')).toBe(1);

    act(() => fakeWindow.dispatch('blur'));

    expect(fakeDocument.body.style).toEqual({
      cursor: 'wait',
      userSelect: 'text',
      webkitUserSelect: 'auto',
    });
    expect(ghost.style.display).toBe('none');
    expect(fakeDocument.listenerCount('mousemove')).toBe(0);
    expect(fakeDocument.listenerCount('mouseup')).toBe(0);
    expect(fakeWindow.listenerCount('blur')).toBe(0);
    expect(setSidebarWidth).toHaveBeenCalledWith(240);
  });

  it('self-heals and commits the last width when movement reports no pressed button', () => {
    beginResize();

    act(() => fakeDocument.dispatch('mousemove', { buttons: 0, clientX: 260 }));

    expect(setSidebarWidth).toHaveBeenCalledWith(300);
    expect(ghost.style.display).toBe('none');
    expect(fakeDocument.body.style.cursor).toBe('wait');
    expect(fakeDocument.body.style.userSelect).toBe('text');
    expect(fakeDocument.listenerCount('mousemove')).toBe(0);
    expect(fakeWindow.listenerCount('blur')).toBe(0);
  });

  it('cancels pending work and restores interaction state when unmounted mid-resize', () => {
    beginResize();
    act(() => fakeDocument.dispatch('mousemove', { buttons: 1, clientX: 250 }));
    expect(scheduledFrames.size).toBe(1);

    act(() => renderer?.unmount());
    renderer = null;

    expect(scheduledFrames.size).toBe(0);
    expect(cancelAnimationFrame).toHaveBeenCalledTimes(1);
    expect(ghost.style.display).toBe('none');
    expect(fakeDocument.body.style).toEqual({
      cursor: 'wait',
      userSelect: 'text',
      webkitUserSelect: 'auto',
    });
    expect(fakeDocument.listenerCount('mousemove')).toBe(0);
    expect(fakeDocument.listenerCount('mouseup')).toBe(0);
    expect(fakeWindow.listenerCount('blur')).toBe(0);
    expect(setSidebarWidth).not.toHaveBeenCalled();
  });
});
