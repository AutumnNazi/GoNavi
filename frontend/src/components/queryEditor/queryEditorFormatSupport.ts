import { LogError, LogInfo } from '../../../wailsjs/runtime';
import { resolveOceanBaseProtocolFromConfig } from '../../utils/oceanBaseProtocol';
import { resolveSqlDialect } from '../../utils/sqlDialect';

export const QUERY_EDITOR_FORMAT_PARAM_TYPES = {
    custom: [
        { regex: String.raw`#\{[^{}]+\}` },
        { regex: String.raw`\$\{[^{}]+\}` },
    ],
};

const QUERY_EDITOR_FORMAT_ERROR_LOG_MAX_LENGTH = 500;

const isOceanBaseOracleConnection = (config: {
    type?: unknown;
    driver?: unknown;
    oceanBaseProtocol?: unknown;
} | null | undefined): boolean => {
    const type = String(config?.type || '').trim().toLowerCase();
    const driver = String(config?.driver || '').trim().toLowerCase();
    if (type !== 'oceanbase' && driver !== 'oceanbase') return false;
    try {
        return resolveOceanBaseProtocolFromConfig((config || {}) as Record<string, unknown>) === 'oracle';
    } catch {
        return false;
    }
};

export const supportsPositionalSqlFormatParams = (config: {
    type?: unknown;
    driver?: unknown;
    oceanBaseProtocol?: unknown;
} | null | undefined): boolean => (
    isOceanBaseOracleConnection(config)
    || resolveSqlDialect(
        String(config?.type || ''),
        String(config?.driver || ''),
        { oceanBaseProtocol: config?.oceanBaseProtocol },
    ) === 'dameng'
);

export const queryEditorFormatNow = (): number => (
    typeof globalThis.performance?.now === 'function'
        ? globalThis.performance.now()
        : Date.now()
);

export const formatQueryEditorFormatDuration = (startedAt: number): string => (
    String(Math.round(Math.max(0, queryEditorFormatNow() - startedAt) * 10) / 10)
);

export const normalizeQueryEditorFormatLogField = (value: unknown, fallback: string): string => {
    const normalized = String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '_')
        .slice(0, 64);
    return normalized || fallback;
};

export const formatQueryEditorFormatError = (error: unknown): string => {
    const messageText = error instanceof Error ? error.message : String(error || 'unknown');
    return messageText
        .replace(/\s+/g, ' ')
        .replace(/Unexpected "(?:[^"\\]|\\.)*"/gi, 'Unexpected <token>')
        .trim()
        .slice(0, QUERY_EDITOR_FORMAT_ERROR_LOG_MAX_LENGTH) || 'unknown';
};

export const writeQueryEditorFormatLog = (level: 'info' | 'error', messageText: string): void => {
    try {
        if (level === 'error') {
            LogError(messageText);
            return;
        }
        LogInfo(messageText);
    } catch {
        // Logging must never change whether formatting succeeds or fails.
    }
};
