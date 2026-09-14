import { describe, expect, it } from 'vitest';
import { isWailsDevNativeContextMenu, shouldAllowNativeContextMenu } from './nativeContextMenu';

type ContextMenuElement = EventTarget & {
  parentElement: ContextMenuElement | null;
  matches: (selector: string) => boolean;
  hasAttribute: (name: string) => boolean;
  getAttribute: (name: string) => string | null;
};

const createElement = ({
  selector,
  contentEditable,
  parent = null,
}: {
  selector?: string;
  contentEditable?: string;
  parent?: ContextMenuElement | null;
} = {}): ContextMenuElement => ({
  parentElement: parent,
  matches: (selectors) => Boolean(selector && selectors.split(',').some((item) => item.trim() === selector)),
  hasAttribute: (name) => name === 'contenteditable' && contentEditable !== undefined,
  getAttribute: (name) => name === 'contenteditable' ? contentEditable ?? null : null,
} as ContextMenuElement);

describe('shouldAllowNativeContextMenu', () => {
  it('allows native menus for editable controls', () => {
    expect(shouldAllowNativeContextMenu(createElement({ selector: 'input' }))).toBe(true);
    expect(shouldAllowNativeContextMenu(createElement({ selector: 'textarea' }))).toBe(true);
    expect(shouldAllowNativeContextMenu(createElement({ selector: '[role="textbox"]' }))).toBe(true);
  });

  it('allows native menus for Monaco and explicit opt-in surfaces', () => {
    expect(shouldAllowNativeContextMenu(createElement({ selector: '.monaco-editor' }))).toBe(true);
    expect(shouldAllowNativeContextMenu(createElement({ selector: '[data-allow-native-context-menu="true"]' }))).toBe(true);
  });

  it('blocks native menus on ordinary application surfaces', () => {
    const surface = createElement();
    const child = createElement({ parent: surface });

    expect(shouldAllowNativeContextMenu(surface)).toBe(false);
    expect(shouldAllowNativeContextMenu(child)).toBe(false);
  });

  it('allows descendants of editable content', () => {
    const editable = createElement({ contentEditable: 'true' });
    expect(shouldAllowNativeContextMenu(createElement({ parent: editable }))).toBe(true);
  });

  it('keeps a disabled nested editing region blocked', () => {
    const editable = createElement({ contentEditable: 'true' });
    const blocked = createElement({ contentEditable: 'false', parent: editable });
    expect(shouldAllowNativeContextMenu(createElement({ parent: blocked }))).toBe(false);
  });

  it('allows the WebView debug menu only for wails dev, not packaged latest or packaged dev', () => {
    expect(isWailsDevNativeContextMenu(true)).toBe(true);
    expect(isWailsDevNativeContextMenu(false)).toBe(false);
    expect(shouldAllowNativeContextMenu(createElement(), { allowDebugMenu: true })).toBe(true);
    expect(shouldAllowNativeContextMenu(createElement(), { allowDebugMenu: false })).toBe(false);
  });
});
