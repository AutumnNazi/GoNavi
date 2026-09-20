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

    // AI 诊断注入用：局部执行保留实际范围；全文执行再解析具体出错语句。
    const resolveExecutionErrorStatement = useCallback((
        error: string,
        currentEditorSql: string,
        dbType?: string,
    ): string => {
        const origin = originRef.current;
        const executedSql = String(origin?.originalSql || '').trim();
        if (executedSql && executedSql !== String(origin?.editorSql || '').trim()) {
            return executedSql;
        }
        const resolved = resolveExecutionErrorStatementText({
            error,
            origin,
            currentEditorSql: origin?.editorSql || currentEditorSql,
            dbType,
        });
        return resolved || executedSql;
    }, []);

    return { recordExecutionOrigin, locateExecutionError, resolveExecutionErrorStatement };
};
