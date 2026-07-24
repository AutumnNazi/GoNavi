import React from 'react';
import { Segmented, Tooltip } from 'antd';
import { CodeOutlined, FileTextOutlined, TableOutlined } from '@ant-design/icons';
import { t as defaultTranslate, type I18nParams } from '../i18n';

type GridViewMode = 'table' | 'json' | 'text' | 'fields' | 'ddl' | 'er' | 'sqlLog';

export type DataGridResultViewTranslate = (key: string, params?: I18nParams) => string;

export interface DataGridResultViewSwitcherProps {
  isV2Ui: boolean;
  darkMode: boolean;
  viewMode: GridViewMode;
  onViewModeChange: (nextMode: GridViewMode) => void;
  translate?: DataGridResultViewTranslate;
}

const DataGridResultViewSwitcher: React.FC<DataGridResultViewSwitcherProps> = ({
  isV2Ui,
  darkMode,
  viewMode,
  onViewModeChange,
  translate = defaultTranslate,
}) => {
  const resultViewLabel = translate('data_grid.view.result_view');
  const viewOptions = [
    { label: translate('data_grid.view.table'), value: 'table', icon: <TableOutlined /> },
    { label: 'JSON', value: 'json', icon: <CodeOutlined /> },
    { label: translate('data_grid.view.text'), value: 'text', icon: <FileTextOutlined /> },
  ];

  return (
    <div
      data-grid-view-switcher="true"
      className={isV2Ui ? 'gn-v2-data-grid-result-switcher' : undefined}
      style={isV2Ui ? undefined : { display: 'flex', alignItems: 'center', gap: 8 }}
    >
      {!isV2Ui && (
        <span style={{ fontSize: 12, color: darkMode ? '#999' : '#666' }}>{resultViewLabel}</span>
      )}
      <Segmented
        aria-label={resultViewLabel}
        size="small"
        value={viewMode === 'json' || viewMode === 'text' ? viewMode : 'table'}
        options={viewOptions.map((option) => ({
          label: isV2Ui ? (
            <Tooltip title={option.label}>
              <span className="gn-v2-data-grid-result-option">
                {option.icon}
                <span className="gn-v2-data-grid-visually-hidden">{option.label}</span>
              </span>
            </Tooltip>
          ) : option.label,
          value: option.value,
        }))}
        onChange={(value) => onViewModeChange(String(value) as GridViewMode)}
      />
    </div>
  );
};

export default DataGridResultViewSwitcher;
