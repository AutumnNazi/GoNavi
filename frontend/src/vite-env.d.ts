/// <reference types="vite/client" />

declare module 'monaco-editor/editor/contrib/clipboard/browser/clipboard.js' {
  export const PasteAction: {
    addImplementation(
      priority: number,
      name: string,
      implementation: () => boolean | Promise<void>,
    ): { dispose(): void };
  } | undefined;
}

declare module 'monaco-editor/editor/browser/controller/editContext/clipboardUtils.js' {
  interface ClipboardMetadata {
    isFromEmptySelection?: boolean;
    multicursorText?: string[] | null;
    mode?: unknown;
  }

  export const InMemoryClipboardMetadataManager: {
    INSTANCE: {
      get(text: string): ClipboardMetadata | null;
    };
  };
}

interface ImportMetaEnv {
  readonly VITE_GONAVI_ENABLE_MAC_WINDOW_DIAGNOSTICS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
