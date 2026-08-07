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

interface MonacoClipboardEditorLike {
  getRawOptions?: () => { readOnly?: boolean };
  hasModel?: () => boolean;
  hasTextFocus?: () => boolean;
  trigger?: (source: string, handlerId: string, payload: unknown) => void;
}

interface MonacoEditorApiLike {
  addCommand?: (descriptor: {
    id: string;
    run: () => Promise<void>;
  }) => { dispose: () => void };
  getEditors?: () => MonacoClipboardEditorLike[];
}

export interface MonacoClipboardApiLike {
  editor?: MonacoEditorApiLike;
}

interface InstalledClipboardCommand {
  refCount: number;
  dispose: () => void;
}

const MONACO_PASTE_COMMAND_ID = 'editor.action.clipboardPasteAction';
const installedClipboardCommands = new WeakMap<object, InstalledClipboardCommand>();
const noop = () => {};

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

export const installWailsMonacoClipboardPasteCommand = (
  monaco: MonacoClipboardApiLike,
  scope: MonacoClipboardScope = globalThis as unknown as MonacoClipboardScope,
): (() => void) => {
  const wailsWindow = scope.window;
  const runtime = wailsWindow?.runtime;
  const editorApi = monaco.editor;
  if (
    typeof wailsWindow?.WailsInvoke !== 'function'
    || typeof runtime?.ClipboardGetText !== 'function'
    || !editorApi
    || typeof editorApi.addCommand !== 'function'
    || typeof editorApi.getEditors !== 'function'
  ) {
    return noop;
  }

  const existing = installedClipboardCommands.get(editorApi);
  if (existing) {
    existing.refCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      existing.refCount -= 1;
      if (existing.refCount === 0) {
        existing.dispose();
        installedClipboardCommands.delete(editorApi);
      }
    };
  }

  const wailsReadText = runtime.ClipboardGetText.bind(runtime);
  let browserReadText: ClipboardReadText | undefined;
  try {
    const clipboard = scope.navigator?.clipboard;
    if (typeof clipboard?.readText === 'function') {
      browserReadText = clipboard.readText.bind(clipboard);
    }
  } catch {
    browserReadText = undefined;
  }

  let commandDisposable: { dispose: () => void };
  try {
    commandDisposable = editorApi.addCommand({
      id: MONACO_PASTE_COMMAND_ID,
      run: async () => {
        const editor = editorApi.getEditors!().find((candidate) => (
          candidate.hasModel?.() !== false && candidate.hasTextFocus?.() === true
        ));
        if (!editor || editor.getRawOptions?.().readOnly === true || typeof editor.trigger !== 'function') {
          return;
        }

        let text: string;
        try {
          text = await readClipboardTextWithFallback(wailsReadText, browserReadText);
        } catch {
          return;
        }
        if (!text) {
          return;
        }

        // Keep Monaco responsible for selections, multi-cursor edits and the undo stack.
        editor.trigger('keyboard', 'paste', {
          text,
          pasteOnNewLine: false,
          multicursorText: null,
          mode: null,
        });
      },
    });
  } catch {
    return noop;
  }

  const installed: InstalledClipboardCommand = {
    refCount: 1,
    dispose: () => commandDisposable.dispose(),
  };
  installedClipboardCommands.set(editorApi, installed);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    installed.refCount -= 1;
    if (installed.refCount === 0) {
      installed.dispose();
      installedClipboardCommands.delete(editorApi);
    }
  };
};
