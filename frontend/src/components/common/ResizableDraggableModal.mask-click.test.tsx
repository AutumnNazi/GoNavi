/**
 * @vitest-environment jsdom
 *
 * Regression for #1297: `ResizableDraggableModal.confirm` renders its dialog
 * through rc-dialog, and antd scales a dialog in from 0.2. While that enter
 * animation runs, the dialog box is still smaller than its final size, so a
 * click aimed at a button that has not grown into place yet lands on the mask.
 * With `maskClosable` (all four confirmations in DataSyncWorkbenchShell pass it)
 * rc-dialog reads that as an outside click: the dialog closes, `onOk` never
 * runs and the backend request is never sent — the user sees the confirmation
 * disappear and believes the action was applied.
 */
import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import Modal from './ResizableDraggableModal';

const ENTER_SETTLE_FALLBACK_MS = 500;

let container: HTMLDivElement;
let root: Root;

const flush = async (ms = 20) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

const confirmTitles = () => Array.from(document.querySelectorAll('.ant-modal-confirm-title'));

const maskOf = (dialog: Element) => dialog.closest('.ant-modal-wrap');

const clickElement = async (element: Element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  });
  await flush(10);
};

const okButtonOf = (dialog: Element) => dialog.querySelector('.ant-modal-confirm .ant-btn-primary');

describe('ResizableDraggableModal confirm mask clicks during the enter animation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<div />);
    });
  });

  afterEach(async () => {
    act(() => Modal.destroyAll());
    await flush(10);
    await act(async () => root.unmount());
    container.remove();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('ignores a mask click while the dialog is still entering', async () => {
    const onOk = vi.fn(async () => undefined);
    const onCancel = vi.fn();

    act(() => {
      Modal.confirm({
        title: 'Delete task',
        content: 'Delete this task?',
        okText: 'Delete',
        cancelText: 'Cancel',
        centered: true,
        closable: true,
        maskClosable: true,
        okButtonProps: { danger: true, type: 'primary' },
        onOk,
        onCancel,
      });
    });
    await flush(50);

    const dialog = confirmTitles()[0].closest('.ant-modal-confirm')!;
    expect(dialog).not.toBeNull();

    await clickElement(maskOf(dialog)!);

    expect(onCancel).not.toHaveBeenCalled();
    expect(confirmTitles()).toHaveLength(1);

    const okButton = okButtonOf(dialog)!;
    await clickElement(okButton);
    expect(onOk).toHaveBeenCalledTimes(1);
  });

  it('keeps guarding a wrap click while the enter motion class is still present past the legacy fallback (issue #1297)', async () => {
    const onOk = vi.fn(async () => undefined);
    const onCancel = vi.fn();

    act(() => {
      Modal.confirm({
        title: 'Delete task',
        content: 'Delete this task?',
        okText: 'Delete',
        cancelText: 'Cancel',
        centered: true,
        closable: true,
        maskClosable: true,
        okButtonProps: { danger: true, type: 'primary' },
        onOk,
        onCancel,
      });
    });
    await flush(50);

    const dialog = confirmTitles()[0].closest('.ant-modal-confirm')!;
    const modalNode = dialog.closest('.ant-modal')!;

    // Simulate a stretched-out web entry: the motion class is still present after
    // the legacy 500ms fallback has fired.
    await flush(450);
    modalNode.classList.add('ant-zoom-appear');
    await flush(50);

    await clickElement(maskOf(dialog)!);
    expect(onCancel).not.toHaveBeenCalled();
    expect(onOk).not.toHaveBeenCalled();
    expect(confirmTitles()).toHaveLength(1);

    // Past the hard cap the guard degrades to stock antd behaviour.
    await flush(2000);
    await clickElement(maskOf(dialog)!);
    await flush(50);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(confirmTitles()).toHaveLength(0);
  });

  it('honors a mask click again once the dialog has settled', async () => {
    const onCancel = vi.fn();

    act(() => {
      Modal.confirm({
        title: 'Delete run',
        content: 'Delete this run?',
        okText: 'Delete',
        cancelText: 'Cancel',
        centered: true,
        closable: true,
        maskClosable: true,
        onOk: async () => undefined,
        onCancel,
      });
    });
    await flush(50);

    const dialog = confirmTitles()[0].closest('.ant-modal-confirm')!;
    await flush(ENTER_SETTLE_FALLBACK_MS + 50);

    await clickElement(maskOf(dialog)!);
    await flush(50);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(confirmTitles()).toHaveLength(0);
  });
});
