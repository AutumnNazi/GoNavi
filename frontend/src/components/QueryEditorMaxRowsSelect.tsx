import React from 'react';
import { Modal, Select, Tooltip } from 'antd';

import { t as defaultTranslate } from '../i18n';
import { useOptionalI18n } from '../i18n/provider';
import {
  QUERY_EDITOR_SAFE_MAX_FIELD_BYTES,
  QUERY_EDITOR_SAFE_MAX_RESULT_BYTES,
  QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
} from './queryEditor/queryEditorResultBudget';

const QueryEditorMaxRowsSelect: React.FC<{
  value: number;
  onChange: (value: number) => void;
}> = ({ value, onChange }) => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? defaultTranslate;
  const safetyParams = {
    rows: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
    size: Math.round(QUERY_EDITOR_SAFE_MAX_RESULT_BYTES / 1024 / 1024),
    fieldSize: Math.round(QUERY_EDITOR_SAFE_MAX_FIELD_BYTES / 1024 / 1024),
  };
  const handleChange = (nextValue: number) => {
    if (nextValue !== 0) {
      onChange(nextValue);
      return;
    }
    Modal.confirm({
      title: t('query_editor.max_rows.unlimited_confirm.title'),
      content: t('query_editor.max_rows.unlimited_confirm.content', safetyParams),
      okText: t('query_editor.max_rows.unlimited_confirm.ok'),
      cancelText: t('common.cancel'),
      onOk: () => onChange(0),
    });
  };
  return (
    <Tooltip title={t('query_editor.max_rows.tooltip', safetyParams)}>
      <Select
        className="gn-v2-query-toolbar-select gn-v2-query-toolbar-max-rows-select"
        value={value}
        onChange={(nextValue) => handleChange(Number(nextValue))}
        options={[
          { label: '100', value: 100 },
          { label: t('query_editor.max_rows.option_500'), value: 500 },
          { label: t('query_editor.max_rows.option_1000'), value: 1000 },
          { label: t('query_editor.max_rows.option_5000'), value: 5000 },
          { label: t('query_editor.max_rows.option_20000'), value: 20000 },
          {
            label: t('query_editor.max_rows.option_unlimited_safe', {
              rows: QUERY_EDITOR_UNLIMITED_SAFE_MAX_ROWS,
            }),
            value: 0,
          },
        ]}
      />
    </Tooltip>
  );
};

export default QueryEditorMaxRowsSelect;
