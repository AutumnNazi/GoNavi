import React from 'react';
import { Alert, Checkbox, Space } from 'antd';
import Modal from './common/ResizableDraggableModal';

import { t } from '../i18n';

export type SQLExportOptions = {
  includeDropIfExists: boolean;
};

export const normalizeSQLExportOptions = (
  options?: Partial<SQLExportOptions>,
): SQLExportOptions => ({
  includeDropIfExists: options?.includeDropIfExists === true,
});

export const SQLExportOptionsDialogContent: React.FC<{
  value: SQLExportOptions;
  onChange: (value: SQLExportOptions) => void;
}> = ({ value, onChange }) => (
  <Space direction="vertical" size={12} style={{ width: '100%' }} data-sql-export-options="true">
    <Checkbox
      defaultChecked={value.includeDropIfExists}
      onChange={(event) => onChange({ includeDropIfExists: event.target.checked })}
    >
      {t('data_export.sql_options.drop_if_exists.label')}
    </Checkbox>
    <Alert
      type="warning"
      showIcon
      message={t('data_export.sql_options.drop_if_exists.description')}
    />
  </Space>
);

export const showSQLExportOptionsDialog = (
  initialOptions?: Partial<SQLExportOptions>,
): Promise<SQLExportOptions | null> => new Promise((resolve) => {
  let resolved = false;
  let latestValue = normalizeSQLExportOptions(initialOptions);

  const finish = (value: SQLExportOptions | null) => {
    if (resolved) return;
    resolved = true;
    resolve(value);
  };

  Modal.confirm({
    title: t('data_export.sql_options.title'),
    width: 520,
    centered: true,
    closable: true,
    maskClosable: true,
    okText: t('data_export.dialog.action.start'),
    cancelText: t('common.cancel'),
    content: (
      <SQLExportOptionsDialogContent
        value={latestValue}
        onChange={(value) => {
          latestValue = value;
        }}
      />
    ),
    onOk: () => finish(latestValue),
    onCancel: () => finish(null),
  });
});
