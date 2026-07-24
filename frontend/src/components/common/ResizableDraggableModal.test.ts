import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const modalSource = readFileSync(
  fileURLToPath(new globalThis.URL('./ResizableDraggableModal.tsx', import.meta.url)),
  'utf8',
);

const modalCss = readFileSync(
  fileURLToPath(new globalThis.URL('./ResizableDraggableModal.css', import.meta.url)),
  'utf8',
);

describe('ResizableDraggableModal guards', () => {
  it('routes component, static, and hook modals through the same draggable frame', () => {
    expect(modalSource).toContain('const DraggableResizableModalFrame: React.FC<DraggableResizableModalFrameProps>');
    expect(modalSource).toContain('<DraggableResizableModalFrame');
    expect(modalSource).toContain('const withDraggableModalRender = (config: ModalFuncProps): ModalFuncProps =>');
    expect(modalSource).toContain('ResizableDraggableModal.info = wrapModalFunc(AntdModal.info);');
    expect(modalSource).toContain('ResizableDraggableModal.success = wrapModalFunc(AntdModal.success);');
    expect(modalSource).toContain('ResizableDraggableModal.error = wrapModalFunc(AntdModal.error);');
    expect(modalSource).toContain('ResizableDraggableModal.warning = wrapModalFunc(AntdModal.warning);');
    expect(modalSource).toContain('ResizableDraggableModal.confirm = wrapModalFunc(AntdModal.confirm);');
    expect(modalSource).toContain('return [wrapHookModalApi(modalApi), contextHolder] as ReturnType<typeof AntdModal.useModal>;');
    expect(modalSource).toContain("const activeInteractionRef = useRef<'drag' | 'resize' | null>(null);");
    expect(modalSource).toContain('const [wrapperElement, setWrapperElement] = useState<HTMLDivElement | null>(null);');
    expect(modalSource).toContain('const bindWrapperRef = useCallback((node: HTMLDivElement | null) =>');
    expect(modalSource).toContain("wrapperElement.addEventListener('pointerdown', handleFrameStart);");
    expect(modalSource).toContain("wrapperElement.addEventListener('mousedown', handleFrameStart);");
    expect(modalSource).toContain("startResize('south-east', event);");
    expect(modalSource).toContain("wrapperElement?.closest('.ant-modal')");
    expect(modalSource).toContain("modalNode.style.width = `${size.width}px`;");
    expect(modalSource).toContain("window.addEventListener('click', suppressInteractionClick, { capture: true, once: true });");
    expect(modalSource).toContain("window.removeEventListener('click', suppressInteractionClick, true);");
    expect(modalSource).toContain("window.addEventListener('blur', handleAbortDrag);");
    expect(modalSource).toContain('if (moveEvent.buttons === 0)');
  });

  it('applies resized width and height to the underlying AntD modal nodes', () => {
    expect(modalSource).toContain("style['--gn-modal-resized-width'] = `${size.width}px`;");
    expect(modalSource).toContain("style['--gn-modal-resized-height'] = `${size.height}px`;");
    expect(modalCss).toContain(".gn-resizable-draggable-modal[data-has-resized-width='true']");
    expect(modalCss).toContain('width: var(--gn-modal-resized-width);');
    expect(modalCss).toContain(".gn-resizable-draggable-modal[data-has-resized-height='true'] .ant-modal-content");
    expect(modalCss).toContain('height: var(--gn-modal-resized-height);');
    expect(modalCss).toMatch(/\.gn-modal-resize-handle\s*\{[^}]*pointer-events:\s*auto;/s);
  });
});
