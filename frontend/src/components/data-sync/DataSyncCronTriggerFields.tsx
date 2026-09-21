import React from 'react';

import { DataSyncField } from './DataSyncField';
import type { DataSyncTriggerPolicy } from './model';
import type { DataSyncWorkbenchTranslate } from './text';

type CronTrigger = Extract<DataSyncTriggerPolicy, { mode: 'cron' }>;

/**
 * Cron scheduling fields. Kept in its own panel so the expression's format
 * contract (`inspectDataSyncCronExpression`) and its user-facing explanation
 * live together, and so the editor file does not grow with every trigger option.
 */
export const DataSyncCronTriggerFields: React.FC<{
  trigger: CronTrigger;
  t: DataSyncWorkbenchTranslate;
  onPatch: (trigger: DataSyncTriggerPolicy) => void;
}> = ({ trigger, t, onPatch }) => (
  <>
    <DataSyncField label={t('trigger.cron_expression')}>
      <input
        className="gn-data-sync-control gn-data-sync-mono"
        value={trigger.expression}
        aria-describedby="gn-data-sync-cron-format"
        onChange={(event) =>
          onPatch({ ...trigger, expression: event.target.value })
        }
      />
      <small id="gn-data-sync-cron-format" className="gn-data-sync-field-hint">
        {t('trigger.cron_expression_hint')}
      </small>
    </DataSyncField>
    <DataSyncField label={t('trigger.timezone')}>
      <input
        className="gn-data-sync-control gn-data-sync-mono"
        value={trigger.timezone}
        onChange={(event) =>
          onPatch({ ...trigger, timezone: event.target.value })
        }
      />
    </DataSyncField>
    <DataSyncField label={t('trigger.overlap')}>
      <select
        className="gn-data-sync-control"
        value={trigger.overlap}
        onChange={(event) =>
          onPatch({
            ...trigger,
            overlap: event.target.value as 'skip' | 'queue',
          })
        }
      >
        <option value="skip">{t('trigger.overlap.skip')}</option>
        <option value="queue">{t('trigger.overlap.queue')}</option>
      </select>
    </DataSyncField>
  </>
);
