import { describe, expect, it, vi } from 'vitest';

import {
  NACOS_JSON_PARSER_ACTION_ID,
  NACOS_JSON_SELECTION_CONTEXT_KEY,
  isJsonLikeText,
  registerNacosJsonParserAction,
} from './nacosJsonParser';

describe('isJsonLikeText', () => {
  it.each([
    ['{"a":1}', true],
    ['[1,2,3]', true],
    ['  {"a": 1}  ', true],
    ['"text"', true],
    ['{\\"a\\":1}', true],
    ['[{\\"a\\":1}]', true],
    ['hello', false],
    ['', false],
    ['   ', false],
    ['{"a":1', false],
    ['C:\\path', false],
    ['trailing\\', false],
  ])('classifies %j as %s', (input, expected) => {
    expect(isJsonLikeText(input)).toBe(expected);
  });
});

const createHarness = (selectedText: string) => {
  const contextKey = { set: vi.fn(), reset: vi.fn() };
  const action = { dispose: vi.fn() };
  const selectionDisposable = { dispose: vi.fn() };
  const contentDisposable = { dispose: vi.fn() };
  const selectionListeners: Array<() => void> = [];
  const contentListeners: Array<() => void> = [];
  const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 8 };
  const editor: any = {
    addAction: vi.fn((_action: any) => action),
    createContextKey: vi.fn(() => contextKey),
    getModel: vi.fn(() => ({ getValueInRange: vi.fn(() => selectedText) })),
    getSelection: vi.fn(() => range),
    onDidChangeCursorSelection: vi.fn((handler: () => void) => {
      selectionListeners.push(handler);
      return selectionDisposable;
    }),
    onDidChangeModelContent: vi.fn((handler: () => void) => {
      contentListeners.push(handler);
      return contentDisposable;
    }),
  };
  return {
    editor,
    contextKey,
    action,
    selectionDisposable,
    contentDisposable,
    selectionListeners,
    contentListeners,
    range,
  };
};

describe('registerNacosJsonParserAction', () => {
  it('registers a selection-gated context menu action', () => {
    const harness = createHarness('{"a":1}');
    const onOpen = vi.fn();

    registerNacosJsonParserAction(harness.editor, {
      label: 'JSON parser',
      onOpen,
    });

    expect(harness.editor.createContextKey).toHaveBeenCalledWith(
      NACOS_JSON_SELECTION_CONTEXT_KEY,
      false,
    );
    expect(harness.editor.addAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: NACOS_JSON_PARSER_ACTION_ID,
        label: 'JSON parser',
        precondition: NACOS_JSON_SELECTION_CONTEXT_KEY,
        contextMenuGroupId: '1_modification',
      }),
    );
    // 初始刷新：选中 JSON 时上下文键为 true。
    expect(harness.contextKey.set).toHaveBeenLastCalledWith(true);
  });

  it('opens the parser with the selected JSON and range', () => {
    const harness = createHarness('{"a":1}');
    const onOpen = vi.fn();
    registerNacosJsonParserAction(harness.editor, { label: 'JSON parser', onOpen });

    harness.editor.addAction.mock.calls[0][0].run();

    expect(onOpen).toHaveBeenCalledWith({ text: '{"a":1}', range: harness.range });
  });

  it('ignores non-JSON selections when the action runs', () => {
    const harness = createHarness('hello');
    const onOpen = vi.fn();
    registerNacosJsonParserAction(harness.editor, { label: 'JSON parser', onOpen });

    expect(harness.contextKey.set).toHaveBeenLastCalledWith(false);
    harness.editor.addAction.mock.calls[0][0].run();

    expect(onOpen).not.toHaveBeenCalled();
  });

  it('refreshes the context key when selection or content changes', () => {
    const harness = createHarness('hello');
    registerNacosJsonParserAction(harness.editor, {
      label: 'JSON parser',
      onOpen: vi.fn(),
    });
    expect(harness.contextKey.set).toHaveBeenLastCalledWith(false);

    harness.editor.getModel.mockReturnValue({ getValueInRange: () => '[1,2]' });
    harness.selectionListeners.forEach((handler) => handler());
    expect(harness.contextKey.set).toHaveBeenLastCalledWith(true);

    harness.editor.getModel.mockReturnValue({ getValueInRange: () => 'nope' });
    harness.contentListeners.forEach((handler) => handler());
    expect(harness.contextKey.set).toHaveBeenLastCalledWith(false);
  });

  it('disposes the action, listeners and context key', () => {
    const harness = createHarness('{"a":1}');
    const dispose = registerNacosJsonParserAction(harness.editor, {
      label: 'JSON parser',
      onOpen: vi.fn(),
    });

    dispose();

    expect(harness.action.dispose).toHaveBeenCalledTimes(1);
    expect(harness.selectionDisposable.dispose).toHaveBeenCalledTimes(1);
    expect(harness.contentDisposable.dispose).toHaveBeenCalledTimes(1);
    expect(harness.contextKey.reset).toHaveBeenCalledTimes(1);
  });

  it('no-ops when the editor cannot create context keys', () => {
    const editorWithoutContextKey = { addAction: vi.fn() };
    const dispose = registerNacosJsonParserAction(editorWithoutContextKey as any, {
      label: 'JSON parser',
      onOpen: vi.fn(),
    });
    expect(editorWithoutContextKey.addAction).not.toHaveBeenCalled();
    expect(() => dispose()).not.toThrow();
  });
});
