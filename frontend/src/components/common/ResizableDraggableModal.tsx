import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal as AntdModal } from 'antd';
import type { ModalFuncProps, ModalProps } from 'antd';
import './ResizableDraggableModal.css';

type ResizeDirection = 'east' | 'south' | 'south-east';

type ModalSize = {
  width?: number;
  height?: number;
};

type ModalPosition = {
  x: number;
  y: number;
};

export type ResizableDraggableModalProps = ModalProps & {
  embedded?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  minResizableWidth?: number;
  minResizableHeight?: number;
};

const DEFAULT_MIN_WIDTH = 360;
const DEFAULT_MIN_HEIGHT = 220;
const VIEWPORT_PADDING = 16;
// antd marks the panel with these classes for the whole zoom-in, and clears them once it
// has settled. Used to tell a dialog that is still growing from one the user can close.
const ENTER_MOTION_CLASS = /(?:^|\s)ant-zoom-(?:appear|enter)(?:\s|$)/;
// Fallbacks for the enter guard below. The poll keeps the guard alive for as long
// as the motion classes are present (web runtimes can stretch the zoom well past
// the ~300ms a browser animation takes - issue #1297 symptom "OK closes like
// cancel without running onOk"), and the hard cap degrades to stock antd
// behaviour when an animation never ends at all.
const ENTER_SETTLE_POLL_MS = 100;
const ENTER_SETTLE_HARD_FALLBACK_MS = 2000;

const isInteractiveTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return !!target.closest('button, a, input, textarea, select, [contenteditable="true"], .ant-select, .ant-picker, .ant-dropdown, .ant-checkbox, .ant-radio');
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

type DraggableResizableModalFrameProps = {
  active?: boolean;
  blockMaskClickUntilSettled?: boolean;
  children: React.ReactNode;
  draggable: boolean;
  resizable: boolean;
  minResizableWidth: number;
  minResizableHeight: number;
};

const DraggableResizableModalFrame: React.FC<DraggableResizableModalFrameProps> = ({
  active = true,
  blockMaskClickUntilSettled = false,
  children,
  draggable,
  resizable,
  minResizableWidth,
  minResizableHeight,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const activeInteractionRef = useRef<'drag' | 'resize' | null>(null);
  const stopInteractionRef = useRef<((updateState?: boolean) => void) | null>(null);
  const pendingClickCleanupRef = useRef<(() => void) | null>(null);
  const [wrapperElement, setWrapperElement] = useState<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<ModalPosition>({ x: 0, y: 0 });
  const [size, setSize] = useState<ModalSize>({});
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!active) {
      stopInteractionRef.current?.();
      pendingClickCleanupRef.current?.();
      setPosition({ x: 0, y: 0 });
      setSize({});
      setIsDragging(false);
      setIsResizing(false);
      activeInteractionRef.current = null;
    }
  }, [active]);

  useEffect(() => () => {
    stopInteractionRef.current?.(false);
    pendingClickCleanupRef.current?.();
  }, []);

  const startDrag = useCallback((event: PointerEvent | MouseEvent) => {
    if (activeInteractionRef.current) return;
    if (!active || !draggable || event.button !== 0 || isInteractiveTarget(event.target)) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    if (!target?.closest('.ant-modal-header, .ant-modal-title, .ant-modal-confirm-title')) return;

    const modalNode = wrapperElement?.closest('.ant-modal');
    if (!(modalNode instanceof HTMLElement)) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const startPosition = { ...position };
    const rect = modalNode.getBoundingClientRect();
    const minX = VIEWPORT_PADDING - rect.left + startPosition.x;
    const maxX = window.innerWidth - VIEWPORT_PADDING - rect.right + startPosition.x;
    const minY = VIEWPORT_PADDING - rect.top + startPosition.y;
    const maxY = window.innerHeight - VIEWPORT_PADDING - rect.bottom + startPosition.y;

    event.preventDefault();
    pendingClickCleanupRef.current?.();
    activeInteractionRef.current = 'drag';
    setIsDragging(true);

    const suppressInteractionClick = (clickEvent: MouseEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
    };

    const removeClickSuppression = () => {
      window.removeEventListener('click', suppressInteractionClick, true);
      if (pendingClickCleanupRef.current === removeClickSuppression) {
        pendingClickCleanupRef.current = null;
      }
    };

    const handleMove = (moveEvent: PointerEvent | MouseEvent) => {
      if (moveEvent.buttons === 0) {
        abortDrag();
        return;
      }
      const nextX = clamp(startPosition.x + moveEvent.clientX - startX, minX, maxX);
      const nextY = clamp(startPosition.y + moveEvent.clientY - startY, minY, maxY);
      setPosition({ x: nextX, y: nextY });
    };

    const finishDrag = (completed: boolean, updateState = true) => {
      if (stopInteractionRef.current !== abortDrag) return;
      stopInteractionRef.current = null;
      activeInteractionRef.current = null;
      if (updateState) {
        setIsDragging(false);
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('pointerup', stopDrag);
      window.removeEventListener('mouseup', stopDrag);
      window.removeEventListener('pointercancel', handleAbortDrag);
      window.removeEventListener('blur', handleAbortDrag);
      if (completed) {
        pendingClickCleanupRef.current = removeClickSuppression;
        window.addEventListener('click', suppressInteractionClick, { capture: true, once: true });
        window.setTimeout(removeClickSuppression, 0);
      } else {
        removeClickSuppression();
      }
    };

    const stopDrag = () => finishDrag(true);
    const abortDrag = (updateState = true) => finishDrag(false, updateState);
    const handleAbortDrag = () => abortDrag();

    stopInteractionRef.current = abortDrag;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('mouseup', stopDrag);
    window.addEventListener('pointercancel', handleAbortDrag);
    window.addEventListener('blur', handleAbortDrag);
  }, [active, draggable, position, wrapperElement]);

  const startResize = useCallback((direction: ResizeDirection, event: PointerEvent | MouseEvent) => {
    if (activeInteractionRef.current) return;
    if (!active || !resizable || event.button !== 0) return;
    const modalContent = wrapperElement?.querySelector('.ant-modal-content');
    const modalNode = wrapperElement?.closest('.ant-modal');
    if (!(modalContent instanceof HTMLElement) || !(modalNode instanceof HTMLElement)) return;

    const startX = event.clientX;
    const startY = event.clientY;
    const rect = modalContent.getBoundingClientRect();
    const modalRect = modalNode.getBoundingClientRect();
    const maxWidth = Math.max(minResizableWidth, window.innerWidth - modalRect.left - VIEWPORT_PADDING);
    const maxHeight = Math.max(minResizableHeight, window.innerHeight - modalRect.top - VIEWPORT_PADDING);
    // Pin only the axis this handle drives. Pinning both would freeze the untouched
    // axis at its measured pixel value and stop it following the viewport.
    const affectsWidth = direction !== 'south';
    const affectsHeight = direction !== 'east';

    event.preventDefault();
    event.stopPropagation();
    pendingClickCleanupRef.current?.();
    activeInteractionRef.current = 'resize';
    setIsResizing(true);
    setSize((previous) => ({
      width: affectsWidth ? rect.width : previous.width,
      height: affectsHeight ? rect.height : previous.height,
    }));

    const suppressInteractionClick = (clickEvent: MouseEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
    };

    const removeClickSuppression = () => {
      window.removeEventListener('click', suppressInteractionClick, true);
      if (pendingClickCleanupRef.current === removeClickSuppression) {
        pendingClickCleanupRef.current = null;
      }
    };

    const handleMove = (moveEvent: PointerEvent | MouseEvent) => {
      if (moveEvent.buttons === 0) {
        abortResize();
        return;
      }
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      setSize((previous) => ({
        width: affectsWidth ? clamp(rect.width + deltaX, minResizableWidth, maxWidth) : previous.width,
        height: affectsHeight ? clamp(rect.height + deltaY, minResizableHeight, maxHeight) : previous.height,
      }));
    };

    const finishResize = (completed: boolean, updateState = true) => {
      if (stopInteractionRef.current !== abortResize) return;
      stopInteractionRef.current = null;
      activeInteractionRef.current = null;
      if (updateState) {
        setIsResizing(false);
      }
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('mouseup', stopResize);
      window.removeEventListener('pointercancel', handleAbortResize);
      window.removeEventListener('blur', handleAbortResize);
      if (completed) {
        pendingClickCleanupRef.current = removeClickSuppression;
        window.addEventListener('click', suppressInteractionClick, { capture: true, once: true });
        window.setTimeout(removeClickSuppression, 0);
      } else {
        removeClickSuppression();
      }
    };

    const stopResize = () => finishResize(true);
    const abortResize = (updateState = true) => finishResize(false, updateState);
    const handleAbortResize = () => abortResize();

    stopInteractionRef.current = abortResize;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('mouseup', stopResize);
    window.addEventListener('pointercancel', handleAbortResize);
    window.addEventListener('blur', handleAbortResize);
  }, [active, minResizableHeight, minResizableWidth, resizable, wrapperElement]);

  useEffect(() => {
    const modalNode = wrapperElement?.closest('.ant-modal');
    if (!(modalNode instanceof HTMLElement) || !size.width) return undefined;

    modalNode.style.width = `${size.width}px`;
    return () => {
      modalNode.style.removeProperty('width');
    };
  }, [size.width, wrapperElement]);

  const handleFrameStart = useCallback((event: PointerEvent | MouseEvent) => {
    const target = event.target instanceof HTMLElement ? event.target : null;
    const resizeHandle = target?.closest('.gn-modal-resize-handle');
    if (resizeHandle instanceof HTMLElement) {
      if (resizeHandle.classList.contains('gn-modal-resize-handle-south-east')) {
        startResize('south-east', event);
        return;
      }
      if (resizeHandle.classList.contains('gn-modal-resize-handle-east')) {
        startResize('east', event);
        return;
      }
      if (resizeHandle.classList.contains('gn-modal-resize-handle-south')) {
        startResize('south', event);
        return;
      }
    }
    startDrag(event);
  }, [startDrag, startResize]);

  const bindWrapperRef = useCallback((node: HTMLDivElement | null) => {
    wrapperRef.current = node;
    setWrapperElement(node);
  }, []);

  useEffect(() => {
    if (!wrapperElement) return undefined;

    wrapperElement.addEventListener('pointerdown', handleFrameStart);
    wrapperElement.addEventListener('mousedown', handleFrameStart);

    return () => {
      wrapperElement.removeEventListener('pointerdown', handleFrameStart);
      wrapperElement.removeEventListener('mousedown', handleFrameStart);
    };
  }, [handleFrameStart, wrapperElement]);

  // Entering, antd scales the dialog in from 0.2, so the content is smaller than its
  // final size and a click aimed at a button that has not grown into place yet lands
  // on the mask instead. For a mask-closable dialog rc-dialog reads that as an outside
  // click and closes without ever running onOk: the request is never sent while the
  // user sees the confirmation disappear. Swallow mask clicks until the panel settles.
  useEffect(() => {
    if (!active || !blockMaskClickUntilSettled) return undefined;
    const modalNode = wrapperElement?.closest('.ant-modal');
    if (!(modalNode instanceof HTMLElement)) return undefined;

    const isEntering = () => ENTER_MOTION_CLASS.test(modalNode.className);
    let settled = !isEntering();
    let hardCapReached = false;
    const settle = () => {
      settled = true;
    };
    const forceSettle = () => {
      settled = true;
      hardCapReached = true;
    };
    const swallowMaskClick = (clickEvent: MouseEvent) => {
      // Only the mask wrapper itself counts; anything inside the dialog must pass.
      const target = clickEvent.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('ant-modal-wrap')) return;
      if (settled && !(isEntering() && !hardCapReached)) return;
      // Issue #1297: on a stretched-out web entry the box is still scaled down, so a
      // click aimed at a button keeps landing on the wrap. Swallow it until the motion
      // classes are gone (or the hard cap degrades to stock antd behaviour).
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
    };

    const observer = new MutationObserver(() => {
      if (!isEntering()) settle();
    });
    observer.observe(modalNode, { attributes: true, attributeFilter: ['class'] });
    modalNode.addEventListener('animationend', settle);
    // A dialog whose animation never reports an end must still become closable.
    const pollTimer = window.setInterval(() => {
      if (!isEntering()) settle();
    }, ENTER_SETTLE_POLL_MS);
    const hardFallbackTimer = window.setTimeout(forceSettle, ENTER_SETTLE_HARD_FALLBACK_MS);
    window.addEventListener('click', swallowMaskClick, true);

    return () => {
      observer.disconnect();
      modalNode.removeEventListener('animationend', settle);
      window.clearInterval(pollTimer);
      window.clearTimeout(hardFallbackTimer);
      window.removeEventListener('click', swallowMaskClick, true);
    };
  }, [active, blockMaskClickUntilSettled, wrapperElement]);

  const frameStyle = useMemo(() => {
    const style = {
      transform: `translate(${position.x}px, ${position.y}px)`,
    } as React.CSSProperties & Record<string, string>;
    if (size.width) {
      style['--gn-modal-resized-width'] = `${size.width}px`;
    }
    if (size.height) {
      style['--gn-modal-resized-height'] = `${size.height}px`;
    }
    return style;
  }, [position.x, position.y, size.height, size.width]);

  return (
    <div
      ref={bindWrapperRef}
      className="gn-resizable-draggable-modal"
      data-draggable={draggable ? 'true' : 'false'}
      data-resizable={resizable ? 'true' : 'false'}
      data-dragging={isDragging ? 'true' : 'false'}
      data-resizing={isResizing ? 'true' : 'false'}
      data-has-resized-width={size.width ? 'true' : 'false'}
      data-has-resized-height={size.height ? 'true' : 'false'}
      data-gonavi-close-shortcut-guard={active ? 'true' : undefined}
      data-gonavi-close-shortcut-blocks-background={active ? 'true' : undefined}
      style={frameStyle}
    >
      {children}
      {resizable ? (
        <>
          <span
            aria-hidden="true"
            className="gn-modal-resize-handle gn-modal-resize-handle-east"
          />
          <span
            aria-hidden="true"
            className="gn-modal-resize-handle gn-modal-resize-handle-south"
          />
          <span
            aria-hidden="true"
            className="gn-modal-resize-handle gn-modal-resize-handle-south-east"
          />
        </>
      ) : null}
    </div>
  );
};

const ResizableDraggableModalBase: React.FC<ResizableDraggableModalProps> = ({
  embedded = false,
  draggable = true,
  resizable = true,
  minResizableWidth = DEFAULT_MIN_WIDTH,
  minResizableHeight = DEFAULT_MIN_HEIGHT,
  modalRender,
  open,
  styles,
  width,
  children,
  ...props
}) => {
  const isTestRuntime = Boolean((import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'test');

  if (embedded) {
    if (!open) return null;
    const footerNode: React.ReactNode = props.footer === null || typeof props.footer === 'function' ? null : props.footer;
    return (
      <div
        className={[
          'gn-embedded-modal',
          props.rootClassName,
          props.className,
        ].filter(Boolean).join(' ')}
        data-gonavi-close-shortcut-guard="true"
        data-gonavi-close-shortcut-blocks-background="true"
        style={props.style}
      >
        {props.title || props.closable !== false ? (
          <div className="gn-embedded-modal-header" style={styles?.header}>
            <div className="gn-embedded-modal-title">{props.title}</div>
            {props.closable !== false ? (
              <button
                type="button"
                className="gn-embedded-modal-close"
                aria-label="Close"
                onClick={(event) => props.onCancel?.(event as unknown as React.MouseEvent<HTMLButtonElement>)}
              >
                ×
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="gn-embedded-modal-body" style={styles?.body}>
          {children}
        </div>
        {footerNode ? (
          <div className="gn-embedded-modal-footer" style={styles?.footer}>
            {footerNode}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <AntdModal
      {...props}
      open={open}
      width={width}
      styles={styles}
      modalRender={isTestRuntime ? modalRender : (modalNode) => {
        const renderedNode = modalRender ? modalRender(modalNode) : modalNode;
        return (
          <DraggableResizableModalFrame
            active={Boolean(open)}
            draggable={draggable}
            resizable={resizable}
            minResizableWidth={minResizableWidth}
            minResizableHeight={minResizableHeight}
          >
            {renderedNode}
          </DraggableResizableModalFrame>
        );
      }}
    >
      {children}
    </AntdModal>
  );
};

type ResizableDraggableModalStatic = React.FC<ResizableDraggableModalProps> & {
  info: typeof AntdModal.info;
  success: typeof AntdModal.success;
  error: typeof AntdModal.error;
  warning: typeof AntdModal.warning;
  confirm: typeof AntdModal.confirm;
  destroyAll: typeof AntdModal.destroyAll;
  useModal: typeof AntdModal.useModal;
};

type ModalConfigUpdate = ModalFuncProps | ((prevConfig: ModalFuncProps) => ModalFuncProps);
type ModalRefWithUpdate = {
  update: (configUpdate: ModalConfigUpdate) => void;
};

const withDraggableModalRender = (
  blockMaskClickUntilSettled: boolean,
  config: ModalFuncProps,
): ModalFuncProps => {
  const originalModalRender = config.modalRender;
  return {
    ...config,
    modalRender: (modalNode) => (
      <DraggableResizableModalFrame
        active
        blockMaskClickUntilSettled={blockMaskClickUntilSettled}
        draggable
        resizable
        minResizableWidth={DEFAULT_MIN_WIDTH}
        minResizableHeight={DEFAULT_MIN_HEIGHT}
      >
        {originalModalRender ? originalModalRender(modalNode) : modalNode}
      </DraggableResizableModalFrame>
    ),
  };
};

// Held across `update()` calls: an update carries only the changed fields, so the mask
// decision from the opening config has to survive it.
const wrapModalRefUpdate = <T extends ModalRefWithUpdate>(
  modalRef: T,
  blockMaskClickUntilSettled: boolean,
): T => {
  const rawUpdate = modalRef.update.bind(modalRef);
  modalRef.update = (configUpdate: ModalConfigUpdate) => {
    rawUpdate(typeof configUpdate === 'function'
      ? (prevConfig) => withDraggableModalRender(blockMaskClickUntilSettled, configUpdate(prevConfig))
      : withDraggableModalRender(blockMaskClickUntilSettled, configUpdate));
  };
  return modalRef;
};

const wrapModalFunc = <T extends (config: ModalFuncProps) => ModalRefWithUpdate>(modalFunc: T): T => (
  ((config: ModalFuncProps) => {
    // antd's static dialogs default to `maskClosable: false`; only the ones that opt in
    // can lose an action to the enter window, so only they need the guard.
    const blockMaskClickUntilSettled = config.maskClosable === true;
    return wrapModalRefUpdate(
      modalFunc(withDraggableModalRender(blockMaskClickUntilSettled, config)),
      blockMaskClickUntilSettled,
    );
  }) as T
);

const wrapHookModalApi = <T extends ReturnType<typeof AntdModal.useModal>[0]>(modalApi: T): T => ({
  ...modalApi,
  info: wrapModalFunc(modalApi.info),
  success: wrapModalFunc(modalApi.success),
  error: wrapModalFunc(modalApi.error),
  warning: wrapModalFunc(modalApi.warning),
  confirm: wrapModalFunc(modalApi.confirm),
}) as T;

const ResizableDraggableModal = ResizableDraggableModalBase as ResizableDraggableModalStatic;

ResizableDraggableModal.info = wrapModalFunc(AntdModal.info);
ResizableDraggableModal.success = wrapModalFunc(AntdModal.success);
ResizableDraggableModal.error = wrapModalFunc(AntdModal.error);
ResizableDraggableModal.warning = wrapModalFunc(AntdModal.warning);
ResizableDraggableModal.confirm = wrapModalFunc(AntdModal.confirm);
ResizableDraggableModal.destroyAll = ((...args: Parameters<typeof AntdModal.destroyAll>) => AntdModal.destroyAll(...args)) as typeof AntdModal.destroyAll;
ResizableDraggableModal.useModal = ((...args: Parameters<typeof AntdModal.useModal>) => {
  const [modalApi, contextHolder] = AntdModal.useModal(...args);
  return [wrapHookModalApi(modalApi), contextHolder] as ReturnType<typeof AntdModal.useModal>;
}) as typeof AntdModal.useModal;

export { DraggableResizableModalFrame };

export default ResizableDraggableModal;
