import React from 'react';

import { t as translate } from '../../i18n';
import {
    formatQueryExecutionElapsed,
    resolveQueryExecutionSpeedIcon,
    useQueryExecutionElapsed,
} from '../QueryEditorToolbar';

type QueryEditorExecutionTimerProps = {
    timingActive: boolean;
    executionRunToken: number;
    completedElapsedMs: number | null;
};

const QueryEditorExecutionTimerComponent: React.FC<QueryEditorExecutionTimerProps> = ({
    timingActive,
    executionRunToken,
    completedElapsedMs,
}) => {
    const elapsedMs = useQueryExecutionElapsed(
        timingActive,
        executionRunToken,
        completedElapsedMs,
    );
    const elapsedText = formatQueryExecutionElapsed(elapsedMs);
    const elapsedLabel = translate('query_editor.execution.elapsed', {
        duration: elapsedText,
    });
    const speedIcon = resolveQueryExecutionSpeedIcon(elapsedMs);

    return (
        <div className="gn-query-execution-statusbar">
            <span
                aria-label={elapsedLabel}
                className="gn-query-execution-timer"
                role="timer"
                title={elapsedLabel}
            >
                <span aria-hidden="true" className="gn-query-execution-speed-icon">
                    {speedIcon}
                </span>
                <span className="gn-query-execution-elapsed">
                    {elapsedText}
                </span>
            </span>
        </div>
    );
};

export const QueryEditorExecutionTimer = React.memo(QueryEditorExecutionTimerComponent);
