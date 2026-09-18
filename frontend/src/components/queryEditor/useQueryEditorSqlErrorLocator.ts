import { useCallback, useRef } from 'react';
import { message } from 'antd';

import { t } from '../../i18n';
import {
    createQueryEditorExecutionOrigin,
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

    return { recordExecutionOrigin, locateExecutionError };
};
