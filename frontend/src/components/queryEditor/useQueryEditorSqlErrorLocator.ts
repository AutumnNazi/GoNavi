import { useCallback, useRef } from 'react';
import { message } from 'antd';

import { t } from '../../i18n';
import {
    createQueryEditorExecutionOrigin,
    resolveExecutionErrorStatementText,
    revealQueryEditorSqlErrorLocation,
    type QueryEditorExecutionOrigin,
    type QueryEditorExecutionOriginStatement,
} from './queryEditorErrorLocation';

type QueryEditorSqlErrorLocatorEditor = {
    current?: Parameters<typeof revealQueryEditorSqlErrorLocation>[0]['editor'];
};

export const useQueryEditorSqlErrorLocator = (
    editorRef: QueryEditorSqlErrorLocatorEditor,
) => {
    const originRef = useRef<QueryEditorExecutionOrigin | null>(null);

    const recordExecutionOrigin = useCallback((
        editorSql: string,
        originalSql: string,
        sentSql?: string,
        statements?: QueryEditorExecutionOriginStatement[],
    ) => {
        originRef.current = createQueryEditorExecutionOrigin(
            editorSql,
            originalSql,
            sentSql,
            statements,
        );
    }, []);

    const locateExecutionError = useCallback((error: string): boolean => {
        const located = revealQueryEditorSqlErrorLocation({
            editor: editorRef.current,
            error,
            origin: originRef.current,
        });
        if (!located) {
            message.warning(t('query_editor.message.locate_error_failed'));
        }
        return located;
    }, [editorRef]);

    // AI 诊断注入用：优先解析出错语句；无位置信息时保留实际执行的选区。
    const resolveExecutionErrorStatement = useCallback((
        error: string,
        currentEditorSql: string,
        dbType?: string,
    ): string => {
        const origin = originRef.current;
        const resolved = resolveExecutionErrorStatementText({
            error,
            origin,
            currentEditorSql: origin?.editorSql || currentEditorSql,
            dbType,
        });
        return resolved || String(origin?.originalSql || '').trim();
    }, []);

    return { recordExecutionOrigin, locateExecutionError, resolveExecutionErrorStatement };
};
