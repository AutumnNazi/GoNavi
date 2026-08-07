type ClipboardReadText = () => string | Promise<string>;

interface ClipboardLike {
  readText: ClipboardReadText;
}

interface WailsClipboardRuntimeLike {
  ClipboardGetText?: ClipboardReadText;
}

interface WailsWindowLike {
  WailsInvoke?: unknown;
  runtime?: WailsClipboardRuntimeLike;
}

export interface MonacoClipboardScope {
  navigator?: {
    clipboard?: ClipboardLike;
  };
  window?: WailsWindowLike;
}

interface DisposableLike {
  dispose: () => void;
}

interface MonacoClipboardEditorLike {
  getOption?: (option: any) => unknown;
  getRawOptions?: () => { readOnly?: boolean };
  hasModel?: () => boolean;
  hasTextFocus?: () => boolean;
  onDidDispose?: (listener: () => void) => DisposableLike;
  trigger?: (source: string, handlerId: string, payload: unknown) => void;
}

interface MonacoEditorApiLike {
  EditorOption?: {
    emptySelectionClipboard?: unknown;
  };
}

export interface MonacoClipboardApiLike {
  editor?: MonacoEditorApiLike;
}

interface MonacoClipboardMetadata {
  isFromEmptySelection?: boolean;
  multicursorText?: string[] | null;
  mode?: unknown;
}

interface MonacoClipboardMetadataManagerLike {
  get: (text: string) => MonacoClipboardMetadata | null;
}

export interface MonacoClipboardPasteActionLike {
  addImplementation?: (
    priority: number,
    name: string,
    implementation: () => boolean | Promise<void>,
  ) => DisposableLike;
}

export interface MonacoClipboardInternals {
  metadataManager: MonacoClipboardMetadataManagerLike;
  pasteAction?: MonacoClipboardPasteActionLike;
}

const MONACO_PASTE_IMPLEMENTATION_PRIORITY = 10001;
const noop = () => {};

let monacoClipboardInternalsPromise: Promise<MonacoClipboardInternals | null> | null = null;

const isWailsClipboardRuntime = (scope: MonacoClipboardScope): boolean => (
  typeof scope.window?.WailsInvoke === 'function'
  && typeof scope.window.runtime?.ClipboardGetText === 'function'
);

const getBrowserClipboardReader = (scope: MonacoClipboardScope): ClipboardReadText | undefined => {
  try {
    const clipboard = scope.navigator?.clipboard;
    return typeof clipboard?.readText === 'function' ? clipboard.readText.bind(clipboard) : undefined;
  } catch {
    return undefined;
  }
};

const loadMonacoClipboardInternals = (): Promise<MonacoClipboardInternals | null> => {
  if (!monacoClipboardInternalsPromise) {
    monacoClipboardInternalsPromise = Promise.all([
      import('monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js'),
      import('monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js'),
    ]).then(([clipboardModule, clipboardUtilsModule]) => {
      // Monaco 0.55.1 ships these symbols without public declarations. The main editor bundle
      // imports both modules, so these are the same instances used by Monaco's default action.
      const pasteAction = (clipboardModule as unknown as {
        PasteAction?: MonacoClipboardPasteActionLike;
      }).PasteAction;
      const metadataManager = (clipboardUtilsModule as unknown as {
        InMemoryClipboardMetadataManager?: { INSTANCE?: MonacoClipboardMetadataManagerLike };
      }).InMemoryClipboardMetadataManager?.INSTANCE;

      return metadataManager ? { pasteAction, metadataManager } : null;
    }).catch(() => null);
  }

  return monacoClipboardInternalsPromise;
};

const createPastePayload = (
  monaco: MonacoClipboardApiLike,
  editor: MonacoClipboardEditorLike,
  text: string,
  metadataManager: MonacoClipboardMetadataManagerLike,
) => {
  // This is Monaco's own text-keyed fallback for data that cannot carry custom clipboard MIME types.
  const metadata = metadataManager.get(text);
  const emptySelectionClipboard = monaco.editor?.EditorOption?.emptySelectionClipboard;
  const pasteOnNewLine = emptySelectionClipboard !== undefined
    && editor.getOption?.(emptySelectionClipboard) === true
    && metadata?.isFromEmptySelection === true;

  return {
    text,
    pasteOnNewLine,
    // Wails only exposes text. Never reconstruct multicursorText from arbitrary line breaks.
    multicursorText: metadata && typeof metadata.multicursorText !== 'undefined'
      ? metadata.multicursorText
      : null,
    mode: metadata?.mode ?? null,
  };
};

const installPasteImplementation = (
  monaco: MonacoClipboardApiLike,
  editor: MonacoClipboardEditorLike,
  scope: MonacoClipboardScope,
  internals: MonacoClipboardInternals,
): (() => void) => {
  const pasteAction = internals.pasteAction;
  const wailsReadText = scope.window?.runtime?.ClipboardGetText;
  if (!pasteAction?.addImplementation || typeof wailsReadText !== 'function') {
    return noop;
  }

  const browserReadText = getBrowserClipboardReader(scope);
  let released = false;
  const implementationDisposable = pasteAction.addImplementation(
    MONACO_PASTE_IMPLEMENTATION_PRIORITY,
    'gonavi-wails-sql-editor',
    () => {
      const trigger = editor.trigger;
      if (
        editor.hasModel?.() === false
        || editor.hasTextFocus?.() !== true
        || editor.getRawOptions?.().readOnly === true
        || typeof trigger !== 'function'
      ) {
        // Let Monaco's default implementation handle another focused editor.
        return false;
      }

      return (async () => {
        let text: string;
        try {
          text = await readClipboardTextWithFallback(wailsReadText.bind(scope.window?.runtime), browserReadText);
        } catch {
          return;
        }
        if (
          released
          || !text
          || editor.hasModel?.() === false
          || editor.hasTextFocus?.() !== true
          || editor.getRawOptions?.().readOnly === true
        ) {
          return;
        }

        trigger('keyboard', 'paste', createPastePayload(monaco, editor, text, internals.metadataManager));
      })();
    },
  );

  let editorDisposeDisposable: DisposableLike | undefined;
  const release = () => {
    if (released) return;
    released = true;
    implementationDisposable.dispose();
    editorDisposeDisposable?.dispose();
  };
  editorDisposeDisposable = editor.onDidDispose?.(release);

  return release;
};

export const readClipboardTextWithFallback = async (
  primaryReadText: ClipboardReadText,
  fallbackReadText?: ClipboardReadText,
): Promise<string> => {
  try {
    return String(await primaryReadText() ?? '');
  } catch (primaryError) {
    if (!fallbackReadText) {
      throw primaryError;
    }
    return String(await fallbackReadText() ?? '');
  }
};

export const installWailsMonacoClipboardPasteHandler = (
  monaco: MonacoClipboardApiLike,
  editor: MonacoClipboardEditorLike,
  scope: MonacoClipboardScope = globalThis as unknown as MonacoClipboardScope,
  internals?: MonacoClipboardInternals,
): (() => void) => {
  if (!isWailsClipboardRuntime(scope)) {
    return noop;
  }

  if (internals) {
    return installPasteImplementation(monaco, editor, scope, internals);
  }

  let released = false;
  let installedCleanup = noop;
  void loadMonacoClipboardInternals().then((loadedInternals) => {
    if (!released && loadedInternals) {
      installedCleanup = installPasteImplementation(monaco, editor, scope, loadedInternals);
    }
  });

  return () => {
    if (released) return;
    released = true;
    installedCleanup();
  };
};
