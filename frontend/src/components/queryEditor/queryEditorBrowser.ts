const CLIPBOARD_WRITE_TIMEOUT_MS = 2000;

export const normalizeBrowserSQLExportFileName = (rawName: string): string => {
    const pathParts = String(rawName || '').trim().split(/[\\/]/);
    let name = String(pathParts[pathParts.length - 1] || '').trim();
    if (!name || name === '.') name = 'query';
    name = name.replace(/[\\/:*?"<>|]/g, '_') || 'query';
    return name.toLowerCase().endsWith('.sql') ? name : `${name}.sql`;
};

export const copyQueryEditorTextToClipboard = async (text: string): Promise<boolean> => {
    const tryAsyncClipboardWrite = async (): Promise<boolean> => {
        if (typeof navigator?.clipboard?.writeText !== 'function') {
            return false;
        }

        try {
            const written = await Promise.race([
                navigator.clipboard.writeText(text).then(() => true as const),
                new Promise<false>((resolve) => setTimeout(() => resolve(false), CLIPBOARD_WRITE_TIMEOUT_MS)),
            ]);
            return written;
        } catch {
            return false;
        }
    };

    if (typeof document?.createElement === 'function' && typeof document?.execCommand === 'function') {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', 'true');
        textarea.setAttribute('aria-hidden', 'true');
        Object.assign(textarea.style, {
            position: 'fixed',
            top: '0',
            left: '-9999px',
            opacity: '0',
            pointerEvents: 'none',
        });

        try {
            document.body?.appendChild?.(textarea);
            textarea.focus?.();
            textarea.select?.();
            textarea.setSelectionRange?.(0, text.length);
            if (document.execCommand('copy')) {
                return true;
            }
        } catch {
            // Fall through to async clipboard APIs when execCommand is unavailable.
        } finally {
            textarea.remove?.();
        }
    }

    if (await tryAsyncClipboardWrite()) {
        return true;
    }
    return false;
};
