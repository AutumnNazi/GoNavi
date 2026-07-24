import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAppLogPanelResize } from './useAppLogPanelResize';

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

describe('useAppLogPanelResize interaction cleanup', () => {
  const previousWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  let renderer: ReactTestRenderer | null = null;
  let resize: ReturnType<typeof useAppLogPanelResize> | null = null;
  let fakeWindow: FakeEventTarget;
  let fakeDocument: FakeEventTarget;
  let ghost: { style: { display: string; top: string } };

  const Harness = () => {
    resize = useAppLogPanelResize();
    return null;
  };

  const beginResize = () => {
    act(() => {
      resize?.handleLogResizeStart({
        button: 0,
        clientY: 500,
        preventDefault: vi.fn(),
      } as unknown as React.MouseEvent);
    });
  };

  beforeEach(() => {
    fakeWindow = new FakeEventTarget();
    fakeDocument = new FakeEventTarget();
    ghost = { style: { display: 'none', top: '' } };
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });
    Object.defineProperty(globalThis, 'document', { configurable: true, value: fakeDocument });

    act(() => {
      renderer = create(<Harness />);
    });
    (resize!.logGhostRef as React.MutableRefObject<any>).current = ghost;
  });

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    resize = null;
    if (previousWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', previousWindowDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'window');
    }
    if (previousDocumentDescriptor) {
      Object.defineProperty(globalThis, 'document', previousDocumentDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('hides the guide and commits the last height when the window blurs', () => {
    beginResize();
    act(() => fakeDocument.dispatch('mousemove', { buttons: 1, clientY: 450 }));

    expect(ghost.style.top).toBe('450px');
    expect(fakeWindow.listenerCount('blur')).toBe(1);

    act(() => fakeWindow.dispatch('blur'));

    expect(resize?.logPanelHeight).toBe(250);
    expect(ghost.style.display).toBe('none');
    expect(fakeDocument.listenerCount('mousemove')).toBe(0);
    expect(fakeDocument.listenerCount('mouseup')).toBe(0);
    expect(fakeWindow.listenerCount('blur')).toBe(0);
  });

  it('self-heals when movement reports no pressed button', () => {
    beginResize();

    act(() => fakeDocument.dispatch('mousemove', { buttons: 0, clientY: 475 }));

    expect(resize?.logPanelHeight).toBe(225);
    expect(ghost.style.display).toBe('none');
    expect(fakeDocument.listenerCount('mousemove')).toBe(0);
    expect(fakeWindow.listenerCount('blur')).toBe(0);
  });

  it('removes listeners and hides the guide without updating state on unmount', () => {
    beginResize();

    act(() => renderer?.unmount());
    renderer = null;

    expect(resize?.logPanelHeight).toBe(200);
    expect(ghost.style.display).toBe('none');
    expect(fakeDocument.listenerCount('mousemove')).toBe(0);
    expect(fakeDocument.listenerCount('mouseup')).toBe(0);
    expect(fakeWindow.listenerCount('blur')).toBe(0);
  });
});
