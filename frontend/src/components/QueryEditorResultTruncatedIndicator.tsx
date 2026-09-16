import React from 'react';
import { Tooltip } from 'antd';
import { WarningOutlined } from '@ant-design/icons';

import { t as defaultTranslate } from '../i18n';
import { useOptionalI18n } from '../i18n/provider';

const QueryEditorResultTruncatedIndicator: React.FC = () => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? defaultTranslate;
  return (
    <Tooltip title={t('query_editor.results_panel.tooltip.safety_truncated')}>
      <WarningOutlined style={{ color: '#faad14', fontSize: 12 }} />
    </Tooltip>
  );
};

export default QueryEditorResultTruncatedIndicator;
