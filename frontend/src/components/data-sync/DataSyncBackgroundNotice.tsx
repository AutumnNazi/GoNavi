import React from 'react';
import { useOptionalI18n } from '../../i18n/provider';
import { t as translate } from '../../i18n';

export const DataSyncBackgroundNotice: React.FC = () => {
  const t = useOptionalI18n()?.t || translate;
  return <p className="gn-data-sync-inline-note" role="note">{t('data_sync.worker.background')}</p>;
};
