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

    // AI 诊断注入用：解析出错的那一条语句；解析不出时返回空串由调用方回退整篇
    const resolveExecutionErrorStatement = useCallback((
        error: string,
        currentEditorSql: string,
        dbType?: string,
    ): string => resolveExecutionErrorStatementText({
        error,
        origin: originRef.current,
        currentEditorSql,
        dbType,
    }), []);

    return { recordExecutionOrigin, locateExecutionError, resolveExecutionErrorStatement };
};
