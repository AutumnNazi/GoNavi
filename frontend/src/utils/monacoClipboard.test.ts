import { describe, expect, it, vi } from 'vitest';

import {
  installWailsMonacoClipboardPasteHandler,
  readClipboardTextWithFallback,
  type MonacoClipboardInternals,
} from './monacoClipboard';

type PasteImplementation = () => boolean | Promise<void>;

const createPasteAction = () => {
  const implementations: Array<{ priority: number; implementation: PasteImplementation }> = [];

  return {
    addImplementation: vi.fn((priority: number, _name: string, implementation: PasteImplementation) => {
      const entry = { priority, implementation };
      implementations.push(entry);
      implementations.sort((left, right) => right.priority - left.priority);
      return {
        dispose: () => {
          const index = implementations.indexOf(entry);
          if (index >= 0) {
            implementations.splice(index, 1);
          }
        },
      };
    }),
    get implementations() {
      return implementations.map((entry) => entry.implementation);
    },
  };
};

const createInternals = (
  pasteAction: ReturnType<typeof createPasteAction>,
  metadataByText = new Map<string, {
    isFromEmptySelection?: boolean;
    multicursorText?: string[] | null;
    mode?: unknown;
  }>(),
): MonacoClipboardInternals => ({
  pasteAction,
  metadataManager: {
    get: vi.fn((text: string) => metadataByText.get(text) ?? null),
  },
});

const createEditor = (overrides: Record<string, unknown> = {}) => ({
  getOption: vi.fn(() => true),
  getRawOptions: vi.fn(() => ({ readOnly: false })),
  hasModel: vi.fn(() => true),
  hasTextFocus: vi.fn(() => false),
  onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
  trigger: vi.fn(),
  ...overrides,
});

const wailsScope = (readText = vi.fn().mockResolvedValue('native text')) => ({
  window: {
    WailsInvoke: vi.fn(),
    runtime: { ClipboardGetText: readText },
  },
});

const runPasteAction = async (implementations: PasteImplementation[]) => {
  for (const implementation of implementations) {
    const result = implementation();
    if (result !== false) {
      await result;
      return;
    }
  }
};

describe('Monaco clipboard fallback', () => {
  it('uses the primary clipboard reader when it can read text', async () => {
    const primaryReadText = vi.fn().mockResolvedValue('native text');
    const fallbackReadText = vi.fn().mockResolvedValue('browser text');

    await expect(readClipboardTextWithFallback(primaryReadText, fallbackReadText))
      .resolves.toBe('native text');
    expect(fallbackReadText).not.toHaveBeenCalled();
  });

  it('falls back when the primary clipboard reader rejects the read', async () => {
    const primaryReadText = vi.fn().mockRejectedValue(new Error('native clipboard unavailable'));
    const fallbackReadText = vi.fn().mockResolvedValue('SELECT * FROM users;');

    await expect(readClipboardTextWithFallback(primaryReadText, fallbackReadText))
      .resolves.toBe('SELECT * FROM users;');
  });

  it('only handles paste while a registered SQL editor has text focus', async () => {
    const pasteAction = createPasteAction();
    const internals = createInternals(pasteAction);
    const sqlEditor = createEditor({ hasTextFocus: vi.fn(() => true) });
    const nonSqlEditor = createEditor({ hasTextFocus: vi.fn(() => true) });
    const scope = wailsScope();

    const releaseSql = installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      sqlEditor,
      scope,
      internals,
    );

    expect(pasteAction.addImplementation).toHaveBeenCalledTimes(1);
    await runPasteAction(pasteAction.implementations);
    expect(scope.window.runtime.ClipboardGetText).toHaveBeenCalledTimes(1);
    expect(sqlEditor.trigger).toHaveBeenCalledWith('keyboard', 'paste', {
      text: 'native text',
      pasteOnNewLine: false,
      multicursorText: null,
      mode: null,
    });
    expect(nonSqlEditor.trigger).not.toHaveBeenCalled();

    releaseSql();
  });

  it('leaves the global paste action to Monaco when only a non-SQL editor is focused', async () => {
    const pasteAction = createPasteAction();
    const internals = createInternals(pasteAction);
    const sqlEditor = createEditor({ hasTextFocus: vi.fn(() => false) });
    const scope = wailsScope();
    const defaultPaste = vi.fn(() => true);
    pasteAction.addImplementation(10000, 'monaco-default-paste', defaultPaste);

    const release = installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      sqlEditor,
      scope,
      internals,
    );

    await runPasteAction(pasteAction.implementations);
    expect(defaultPaste).toHaveBeenCalledTimes(1);
    expect(scope.window.runtime.ClipboardGetText).not.toHaveBeenCalled();
    expect(sqlEditor.trigger).not.toHaveBeenCalled();
    release();
  });

  it('routes paste to the SQL editor that currently has focus and cleans each editor independently', async () => {
    const pasteAction = createPasteAction();
    const internals = createInternals(pasteAction);
    let focusedEditor = 'first';
    const firstEditor = createEditor({ hasTextFocus: vi.fn(() => focusedEditor === 'first') });
    const secondEditor = createEditor({ hasTextFocus: vi.fn(() => focusedEditor === 'second') });
    const scope = wailsScope(vi.fn().mockResolvedValue('native text'));
    const monaco = { editor: { EditorOption: { emptySelectionClipboard: 45 } } };

    const releaseFirst = installWailsMonacoClipboardPasteHandler(monaco, firstEditor, scope, internals);
    const releaseSecond = installWailsMonacoClipboardPasteHandler(monaco, secondEditor, scope, internals);

    await runPasteAction(pasteAction.implementations);
    expect(firstEditor.trigger).toHaveBeenCalledTimes(1);
    expect(secondEditor.trigger).not.toHaveBeenCalled();

    focusedEditor = 'second';
    await runPasteAction(pasteAction.implementations);
    expect(firstEditor.trigger).toHaveBeenCalledTimes(1);
    expect(secondEditor.trigger).toHaveBeenCalledTimes(1);

    releaseSecond();
    expect(pasteAction.implementations).toHaveLength(1);
    expect(pasteAction.implementations[0]()).toBe(false);

    releaseFirst();
    expect(pasteAction.implementations).toHaveLength(0);
  });

  it('automatically unregisters a disposed SQL editor', () => {
    const pasteAction = createPasteAction();
    const internals = createInternals(pasteAction);
    let onDispose: (() => void) | undefined;
    const editor = createEditor({
      onDidDispose: vi.fn((listener: () => void) => {
        onDispose = listener;
        return { dispose: vi.fn() };
      }),
    });

    installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      editor,
      wailsScope(),
      internals,
    );

    expect(pasteAction.implementations).toHaveLength(1);
    onDispose?.();
    expect(pasteAction.implementations).toHaveLength(0);
  });

  it('does not paste after the SQL editor is released during an async clipboard read', async () => {
    const pasteAction = createPasteAction();
    const internals = createInternals(pasteAction);
    const editor = createEditor({ hasTextFocus: vi.fn(() => true) });
    let resolveRead: ((text: string) => void) | undefined;
    const wailsReadText = vi.fn(() => new Promise<string>((resolve) => {
      resolveRead = resolve;
    }));

    const release = installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      editor,
      wailsScope(wailsReadText),
      internals,
    );

    const pastePromise = runPasteAction(pasteAction.implementations);
    release();
    resolveRead?.('late text');
    await pastePromise;

    expect(editor.trigger).not.toHaveBeenCalled();
    expect(pasteAction.implementations).toHaveLength(0);
  });

  it('reuses Monaco metadata for matching multi-cursor and whole-line copies only', async () => {
    const pasteAction = createPasteAction();
    const metadata = new Map([
      ['first value\nsecond value', {
        isFromEmptySelection: false,
        multicursorText: ['first value', 'second value'],
        mode: null,
      }],
      ['whole line\n', {
        isFromEmptySelection: true,
        multicursorText: null,
        mode: null,
      }],
    ]);
    const internals = createInternals(pasteAction, metadata);
    const editor = createEditor({ hasTextFocus: vi.fn(() => true) });
    const wailsReadText = vi.fn()
      .mockResolvedValueOnce('first value\nsecond value')
      .mockResolvedValueOnce('whole line\n')
      .mockResolvedValueOnce('foreign text');

    const release = installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      editor,
      wailsScope(wailsReadText),
      internals,
    );

    await runPasteAction(pasteAction.implementations);
    expect(editor.trigger).toHaveBeenLastCalledWith('keyboard', 'paste', {
      text: 'first value\nsecond value',
      pasteOnNewLine: false,
      multicursorText: ['first value', 'second value'],
      mode: null,
    });

    await runPasteAction(pasteAction.implementations);
    expect(editor.trigger).toHaveBeenLastCalledWith('keyboard', 'paste', {
      text: 'whole line\n',
      pasteOnNewLine: true,
      multicursorText: null,
      mode: null,
    });

    await runPasteAction(pasteAction.implementations);
    expect(editor.trigger).toHaveBeenLastCalledWith('keyboard', 'paste', {
      text: 'foreign text',
      pasteOnNewLine: false,
      multicursorText: null,
      mode: null,
    });
    expect(internals.metadataManager.get).toHaveBeenCalledWith('foreign text');

    release();
  });

  it('uses the browser reader if the Wails clipboard is temporarily unavailable', async () => {
    const pasteAction = createPasteAction();
    const internals = createInternals(pasteAction);
    const browserReadText = vi.fn().mockResolvedValue('browser text');
    const wailsReadText = vi.fn().mockRejectedValue(new Error('native clipboard unavailable'));
    const editor = createEditor({ hasTextFocus: vi.fn(() => true) });

    const release = installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      editor,
      {
        navigator: { clipboard: { readText: browserReadText } },
        ...wailsScope(wailsReadText),
      },
      internals,
    );

    await runPasteAction(pasteAction.implementations);
    expect(wailsReadText).toHaveBeenCalledTimes(1);
    expect(browserReadText).toHaveBeenCalledTimes(1);
    expect(editor.trigger).toHaveBeenCalledWith('keyboard', 'paste', expect.objectContaining({ text: 'browser text' }));
    release();
  });

  it('does not register outside the Wails runtime', () => {
    const pasteAction = createPasteAction();
    const release = installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      createEditor(),
      {
        navigator: { clipboard: { readText: vi.fn().mockResolvedValue('browser text') } },
        window: { runtime: { ClipboardGetText: vi.fn().mockResolvedValue('bridge text') } },
      },
      createInternals(pasteAction),
    );

    expect(pasteAction.addImplementation).not.toHaveBeenCalled();
    release();
  });

  it('does not read or paste into a read-only SQL editor', () => {
    const pasteAction = createPasteAction();
    const internals = createInternals(pasteAction);
    const editor = createEditor({
      getRawOptions: vi.fn(() => ({ readOnly: true })),
      hasTextFocus: vi.fn(() => true),
    });
    const scope = wailsScope();

    const release = installWailsMonacoClipboardPasteHandler(
      { editor: { EditorOption: { emptySelectionClipboard: 45 } } },
      editor,
      scope,
      internals,
    );

    expect(pasteAction.implementations[0]()).toBe(false);
    expect(scope.window.runtime.ClipboardGetText).not.toHaveBeenCalled();
    expect(editor.trigger).not.toHaveBeenCalled();
    release();
  });
});
