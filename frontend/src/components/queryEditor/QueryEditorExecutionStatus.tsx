import React from 'react';

import { t as translate } from '../../i18n';
import type { QueryEditorExecutionLifecycleState } from './queryEditorExecutionLifecycle';
import { queryEditorExecutionStatusI18nKey } from './queryEditorExecutionLifecycle';

type QueryEditorExecutionStatusProps = {
    lifecycle: QueryEditorExecutionLifecycleState;
    compact?: boolean;
};

const QueryEditorExecutionStatusComponent: React.FC<QueryEditorExecutionStatusProps> = ({
    lifecycle,
    compact = false,
}) => {
    const statusKey = queryEditorExecutionStatusI18nKey(lifecycle.status);
    if (!statusKey) {
        return null;
    }
    const statusText = translate(statusKey);
    const details: string[] = [];
    if (lifecycle.backendAlive) {
        details.push(translate('query_editor.execution.backend_alive'));
    }
    if (lifecycle.hasAffectedRows) {
        details.push(translate('query_editor.result.affected_rows', { count: lifecycle.affectedRows ?? 0 }));
    } else if (lifecycle.status === 'running' || lifecycle.status === 'starting' || lifecycle.status === 'stalled') {
        details.push(translate('query_editor.execution.affected_rows_pending'));
    }
    if (lifecycle.outcomeUnknown) {
        details.push(translate('query_editor.execution.outcome_unknown'));
    }
    if (lifecycle.message) {
        details.push(lifecycle.message);
    }

    return (
        <div
            className={`gn-query-execution-status${compact ? ' is-compact' : ''}`}
            data-status={lifecycle.status}
            role="status"
        >
            <strong className="gn-query-execution-status-title">{statusText}</strong>
            {details.map((detail) => (
                <span key={detail} className="gn-query-execution-status-detail">{detail}</span>
            ))}
        </div>
    );
};

export const QueryEditorExecutionStatus = React.memo(QueryEditorExecutionStatusComponent);
