// @vitest-environment jsdom
import { Button, Slider } from 'antd';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BACKGROUND_IMAGE_STORAGE_KEY, useBackgroundImageStore as store } from '../../backgroundImageStore';
import { I18nProvider } from '../../i18n/provider';
import BackgroundImageStyleHost from '../theme/BackgroundImageStyleHost';
import BackgroundImagePositionSettings from './BackgroundImagePositionSettings';

const image = { name: 'comic-1920x1080.jpg', dataUrl: 'data:image/jpeg;base64,/9j//9k=' };
let view: ReactTestRenderer | undefined;
let target: HTMLDivElement;
let root: HTMLElement;
const error = vi.fn();
const content = (disabled = false) => (
  <I18nProvider preference="en-US" onPreferenceChange={() => undefined}>
    <BackgroundImageStyleHost />
    <BackgroundImagePositionSettings image={image} disabled={disabled} onError={error} />
  </I18nProvider>
);
const mount = (disabled = false) => act(() => { view = create(content(disabled)); });
const preview = () => view!.root.findByProps({ className: 'gonavi-background-position-preview' });
const start = (extra = {}) => act(() => preview().props.onPointerDown({
  currentTarget: target, pointerId: 1, isPrimary: true, button: 0,
  clientX: 100, clientY: 100, preventDefault: vi.fn(), ...extra,
}));
const pointer = (type: string, clientX = 100, clientY = 100, pointerId = 1) => act(() => {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  document.dispatchEvent(event);
});
const writeSpy = () => vi.spyOn(Storage.prototype, 'setItem');

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  store.setState({ image, builtinId: null, enabled: true, opacity: 15, positionX: 0, positionY: 0, previewPosition: null });
  error.mockReset();
  vi.stubGlobal('innerWidth', 1280);
  vi.stubGlobal('innerHeight', 720);
  root = document.createElement('main');
  root.className = 'gn-v2-app-root';
  document.body.append(root);
  target = document.createElement('div');
  target.getBoundingClientRect = () => ({ width: 320, height: 180 }) as DOMRect;
  target.setPointerCapture = vi.fn();
  target.hasPointerCapture = vi.fn(() => true);
  target.releasePointerCapture = vi.fn();
});

afterEach(() => {
  act(() => view?.unmount());
  view = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('background position preview', () => {
  it('moves equal-aspect cover images horizontally and vertically, updates the window live, and writes only on release', () => {
    mount();
    const write = writeSpy();
    expect(preview().props.style.aspectRatio).toBe(1280 / 720);
    start();
    expect(target.setPointerCapture).toHaveBeenCalledWith(1);
    pointer('pointermove', 180, 55);
    expect(view!.root.findByType('img').props.style.transform).toBe('translate(25%, -25%)');
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('25vw');
    expect(root.style.getPropertyValue('--gn-background-offset-y')).toBe('-25vh');
    expect(root.style.getPropertyValue('--gn-background-tint')).toBe('85%');
    expect(store.getState().positionX).toBe(0);
    expect(write).not.toHaveBeenCalled();
    pointer('pointerup');
    expect(write).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ positionX: 25, positionY: -25, previewPosition: null });
    expect(JSON.parse(localStorage.getItem(BACKGROUND_IMAGE_STORAGE_KEY)!)).toMatchObject({ positionX: 25, positionY: -25 });
    expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
    pointer('pointermove', 200, 200);
    pointer('pointerup');
    expect(write).toHaveBeenCalledOnce();
  });

  it.each(['pointercancel', 'lostpointercapture', 'blur', 'unmount'])('commits the last preview once on %s', (end) => {
    mount();
    const write = writeSpy();
    start();
    pointer('pointermove', 132, 118);
    if (end === 'blur') act(() => { window.dispatchEvent(new Event('blur')); });
    else if (end === 'unmount') { act(() => view!.unmount()); view = undefined; }
    else pointer(end);
    expect(write).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({ positionX: 10, positionY: 10, previewPosition: null });
  });

  it('uses document fallback when pointer capture throws and clamps both axes', () => {
    target.setPointerCapture = () => { throw new Error('unsupported'); };
    mount();
    start();
    pointer('pointermove', 10000, -10000);
    expect(store.getState().previewPosition).toEqual({ positionX: 100, positionY: -100 });
    pointer('pointerup');
    expect(store.getState()).toMatchObject({ positionX: 100, positionY: -100 });
  });

  it('ignores secondary pointers, unrelated release and disabled dragging', () => {
    mount();
    const write = writeSpy();
    start({ button: 2 });
    pointer('pointermove', 200, 200);
    expect(store.getState().previewPosition).toBeNull();
    start();
    pointer('pointermove', 200, 200, 2);
    pointer('pointerup', 200, 200, 2);
    expect(store.getState().previewPosition).toBeNull();
    pointer('pointermove', 132, 118);
    pointer('pointerup');
    expect(write).toHaveBeenCalledOnce();
    act(() => view!.update(content(true)));
    start();
    pointer('pointermove', 200, 200);
    pointer('pointerup');
    expect(write).toHaveBeenCalledOnce();
  });

  it('keeps preview aspect ratio in sync with window resizing without changing position', () => {
    mount();
    vi.stubGlobal('innerWidth', 720);
    vi.stubGlobal('innerHeight', 1280);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(preview().props.style.aspectRatio).toBe(720 / 1280);
    expect(store.getState()).toMatchObject({ positionX: 0, positionY: 0 });
  });

  it('reverts preview and window offsets on persistence failure and reports a translatable error', () => {
    store.setState({ positionX: 12, positionY: -34 });
    mount();
    writeSpy().mockImplementation(() => { throw new Error('quota'); });
    start();
    pointer('pointermove', 132, 118);
    pointer('pointerup');
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'storage-failed' }));
    expect(store.getState()).toMatchObject({ positionX: 12, positionY: -34, previewPosition: null });
    expect(root.style.getPropertyValue('--gn-background-offset-x')).toBe('12vw');
    expect(view!.root.findByType('img').props.style.transform).toBe('translate(12%, -34%)');
  });

  it('does not resurrect stale offsets when the image is cleared before gesture completion', () => {
    mount();
    start();
    pointer('pointermove', 132, 118);
    act(() => store.getState().clearImage());
    const write = writeSpy();
    pointer('pointerup');
    expect(write).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({ image: null, positionX: 0, positionY: 0 });
  });

  it('offers labelled precise sliders with live changes, one commit and a center-only reset', () => {
    mount();
    const write = writeSpy();
    const sliders = () => view!.root.findAllByType(Slider);
    expect(sliders()[0].props).toMatchObject({ min: -100, max: 100, step: 0.1, ariaLabelForHandle: 'Horizontal Offset' });
    expect(sliders()[1].props.ariaLabelForHandle).toBe('Vertical Offset');
    act(() => sliders()[0].props.onChange(12.3));
    act(() => sliders()[1].props.onChange(-45.6));
    expect(write).not.toHaveBeenCalled();
    expect(root.style.getPropertyValue('--gn-background-offset-y')).toBe('-45.6vh');
    act(() => sliders()[1].props.onChangeComplete(-45.6));
    expect(write).toHaveBeenCalledOnce();
    act(() => view!.root.findByType(Button).props.onClick());
    expect(store.getState()).toMatchObject({ image, opacity: 15, positionX: 0, positionY: 0 });
    expect(write).toHaveBeenCalledTimes(2);
  });

  it('commits slider edits on focus loss even without a completion event', () => {
    mount();
    act(() => view!.root.findAllByType(Slider)[0].props.onChange(7));
    act(() => view!.root.findByProps({ className: 'gonavi-background-position' }).props.onBlur());
    expect(store.getState()).toMatchObject({ positionX: 7, previewPosition: null });
  });

  it('supports actual arrow and boundary keys on the accessible slider handles', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const domRoot = createRoot(container);
    act(() => domRoot.render(content()));
    try {
      const handles = container.querySelectorAll<HTMLElement>('[role="slider"]');
      expect(handles).toHaveLength(2);
      const key = (index: number, name: string, keyCode: number) => act(() => {
        handles[index].dispatchEvent(new KeyboardEvent('keydown', { key: name, keyCode, bubbles: true }));
        handles[index].dispatchEvent(new KeyboardEvent('keyup', { key: name, keyCode, bubbles: true }));
      });
      key(0, 'ArrowRight', 39);
      expect(store.getState().positionX).toBe(0.1);
      key(1, 'End', 35);
      expect(store.getState().positionY).toBe(100);
      key(1, 'Home', 36);
      expect(store.getState().positionY).toBe(-100);
    } finally { act(() => domRoot.unmount()); }
  });

  it('uses cover in a clipped, theme-colored preview without scaling on drag', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/settings/BackgroundImagePositionSettings.css'), 'utf8');
    expect(css).toContain('object-fit: cover;');
    expect(css).toContain('object-position: center;');
    expect(css).toContain('overflow: hidden;');
    expect(css).toContain('background-color: var(--gn-bg-panel-2);');
    expect(css).toContain('touch-action: none;');
    expect(css).not.toContain('scale(');
  });
});
