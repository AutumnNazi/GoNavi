import React from 'react';

import { t } from '../../i18n';
import {
  useQueryEditorTabExecutionAppearance,
  type QueryEditorTabExecutionAppearance,
} from './queryEditorTabExecutionState';

type QueryEditorTabRunningIndicatorProps = {
  tabId: string;
};

const appearanceStatusKey: Record<Exclude<QueryEditorTabExecutionAppearance, 'idle'>, string> = {
  running: 'query_editor.execution.status.running',
  done: 'query_editor.execution.status.done',
  error: 'query_editor.execution.status.error',
  read: 'query_editor.execution.status.read',
};

const QueryEditorTabRunningIndicatorComponent: React.FC<QueryEditorTabRunningIndicatorProps> = ({
  tabId,
}) => {
  const appearance = useQueryEditorTabExecutionAppearance(tabId);
  if (appearance === 'idle') return null;
  const label = t(appearanceStatusKey[appearance]);
  return (
    <span
      className="gn-v2-tab-running-indicator"
      data-testid="query-editor-tab-running"
      data-status={appearance}
      role="status"
      aria-label={label}
      title={label}
    >
      <span className="gn-v2-tab-running-dot" aria-hidden="true" />
    </span>
  );
};

export const QueryEditorTabRunningIndicator = React.memo(QueryEditorTabRunningIndicatorComponent);
