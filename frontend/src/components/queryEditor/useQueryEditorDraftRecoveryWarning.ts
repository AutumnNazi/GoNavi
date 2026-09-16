import { useEffect, useRef } from 'react';
import { message } from 'antd';

import { t } from '../../i18n';
import {
  getQueryTabDraftBudgetState,
  QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH,
  subscribeQueryTabDraftBudgetChanges,
  type QueryTabDraftBudgetState,
} from '../../utils/sqlFileTabDrafts';

const recoveryLimitLabel = `${QUERY_TAB_DRAFT_SNAPSHOT_MAX_TEXT_LENGTH / (1024 * 1024)} MiB`;

export const useQueryEditorDraftRecoveryWarning = (tabId: string): void => {
  const warnedRef = useRef(false);

  useEffect(() => {
    warnedRef.current = false;
    const notify = (state: QueryTabDraftBudgetState | null) => {
      if (!state?.recoveryTruncated) {
        warnedRef.current = false;
        return;
      }
      if (warnedRef.current) return;
      warnedRef.current = true;
      void message.warning(t('query_editor.message.draft_recovery_limited', {
        limit: recoveryLimitLabel,
      }));
    };

    notify(getQueryTabDraftBudgetState(tabId));
    return subscribeQueryTabDraftBudgetChanges((state) => {
      if (state.tabId === tabId) notify(state);
    });
  }, [tabId]);
};
