import React from 'react';
import { Button, Popover, Tooltip } from 'antd';
import {
  AimOutlined,
  BugOutlined,
  ConsoleSqlOutlined,
  EditOutlined,
  FileTextOutlined,
  LinkOutlined,
  TableOutlined,
} from '@ant-design/icons';
import { t as defaultTranslate, type I18nParams } from '../i18n';

type GridViewMode = 'table' | 'json' | 'text' | 'fields' | 'ddl' | 'er' | 'sqlLog';

export type DataGridSecondaryActionsTranslate = (key: string, params?: I18nParams) => string;

export interface DataGridSecondaryActionsProps {
  isV2Ui: boolean;
  canViewDdl: boolean;
  canOpenObjectDesigner: boolean;
  viewMode: GridViewMode;
  ddlLoading: boolean;
  showColumnComment: boolean;
  showColumnType: boolean;
  resultViewSwitcher: React.ReactNode;
  columnInfoSettingContent: React.ReactNode;
  columnQuickFindContent: React.ReactNode;
  pageFindContent: React.ReactNode;
  paginationContent: React.ReactNode;
  onViewModeChange: (nextMode: GridViewMode) => void;
  dataPanelOpen: boolean;
  isTableSurfaceActive: boolean;
  onToggleDataPanel: () => void;
  onOpenTableDdl: () => void;
  translate?: DataGridSecondaryActionsTranslate;
}

const DataGridSecondaryActions: React.FC<DataGridSecondaryActionsProps> = ({
  isV2Ui,
  canViewDdl,
  canOpenObjectDesigner,
  viewMode,
  ddlLoading,
  showColumnComment,
  showColumnType,
  resultViewSwitcher,
  columnInfoSettingContent,
  columnQuickFindContent,
  pageFindContent,
  paginationContent,
  onViewModeChange,
  dataPanelOpen,
  isTableSurfaceActive,
  onToggleDataPanel,
  onOpenTableDdl,
  translate = defaultTranslate,
}) => {
  const [columnDisplayOpen, setColumnDisplayOpen] = React.useState(false);

  if (isV2Ui) {
    const fieldsActionLabel = canOpenObjectDesigner
      ? translate('data_grid.secondary.object_design')
      : translate('data_grid.column_settings.field_info');
    const fieldsActionIcon = canOpenObjectDesigner ? <EditOutlined /> : <FileTextOutlined />;
    const columnDisplayLabel = translate('data_grid.secondary.column_display');
    const viewTabItems: Array<{ key: GridViewMode; label: string; icon: React.ReactNode; disabled?: boolean }> = [
      { key: 'table', label: translate('data_grid.secondary.data_preview'), icon: <TableOutlined /> },
      { key: 'fields', label: fieldsActionLabel, icon: fieldsActionIcon },
      { key: 'ddl', label: translate('data_grid.secondary.view_ddl'), icon: <ConsoleSqlOutlined />, disabled: !canViewDdl },
      { key: 'er', label: translate('data_grid.secondary.er_diagram'), icon: <LinkOutlined /> },
      { key: 'sqlLog', label: translate('log_panel.short_title'), icon: <BugOutlined /> },
    ];

    return (
      <div data-grid-secondary-actions="true" className="gn-v2-data-grid-statusbar">
        <div className="gn-v2-data-grid-status-main">
          <div className="gn-v2-data-grid-view-tabs">
            {viewTabItems.map((item) => {
              const isActive = viewMode === item.key
                || (item.key === 'table' && (viewMode === 'json' || viewMode === 'text'));

              return (
                <Tooltip key={item.key} title={item.label}>
                  <Button
                    data-grid-ddl-action={item.key === 'ddl' && canViewDdl ? 'true' : undefined}
                    className="gn-v2-data-grid-toolbar-action"
                    aria-label={item.label}
                    aria-pressed={isActive}
                    size="small"
                    type={isActive ? 'primary' : 'text'}
                    icon={item.icon}
                    disabled={item.disabled}
                    loading={item.key === 'ddl' && ddlLoading}
                    onClick={() => {
                      if (item.key === 'table') {
                        onViewModeChange('table');
                        return;
                      }
                      onViewModeChange(item.key);
                    }}
                  />
                </Tooltip>
              );
            })}
          </div>
          <div className="gn-v2-toolbar-divider" />
          {resultViewSwitcher}
          <Popover
            trigger="click"
            placement="topRight"
            content={columnInfoSettingContent}
            open={columnDisplayOpen}
            onOpenChange={setColumnDisplayOpen}
          >
            <Tooltip title={columnDisplayLabel} open={columnDisplayOpen ? false : undefined}>
              <Button
                data-grid-column-display-action="true"
                className="gn-v2-data-grid-toolbar-action"
                aria-label={columnDisplayLabel}
                aria-pressed={showColumnComment || showColumnType}
                size="small"
                type={showColumnComment || showColumnType ? 'primary' : 'text'}
                icon={<FileTextOutlined />}
              />
            </Tooltip>
          </Popover>
          <Popover trigger="click" placement="topRight" content={<div style={{ padding: 4 }}>{columnQuickFindContent}</div>}>
            <Button
              data-grid-column-quick-find-action="true"
              size="small"
              type="text"
              icon={<AimOutlined />}
          >
              {translate('data_grid.secondary.jump_column')}
            </Button>
          </Popover>
        </div>
        <div className="gn-v2-data-grid-status-right">
          {paginationContent}
        </div>
      </div>
    );
  }

  return (
    <>
      <div
        data-grid-secondary-actions="true"
        data-grid-legacy-secondary-actions="true"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '4px 0 0',
        }}
      >
        <div
          data-grid-legacy-secondary-row="primary"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'flex-start',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flex: '0 1 auto', minWidth: 0 }}>
            <Button
              icon={<EditOutlined />}
              type={dataPanelOpen ? 'primary' : 'default'}
              disabled={!isTableSurfaceActive}
              onClick={onToggleDataPanel}
            >
              {translate('data_grid.secondary.data_preview')}
            </Button>
            <Popover trigger="click" placement="bottomRight" content={columnInfoSettingContent}>
              <Button data-grid-column-display-action="true" icon={<FileTextOutlined />}>{translate('data_grid.column_settings.field_info')}</Button>
            </Popover>
            {canViewDdl && (
              <Button
                data-grid-ddl-action="true"
                icon={<FileTextOutlined />}
                loading={ddlLoading}
                onClick={onOpenTableDdl}
              >
                {translate('data_grid.secondary.view_ddl')}
              </Button>
            )}
          </div>
          <div
            data-grid-legacy-result-view-switcher="true"
            style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}
          >
            {resultViewSwitcher}
          </div>
        </div>
        <div
          data-grid-legacy-secondary-row="search"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            justifyContent: 'flex-start',
            minHeight: 32,
          }}
        >
          {columnQuickFindContent ? (
            <div
              data-grid-legacy-column-quick-find="true"
              style={{ display: 'flex', flex: '0 1 240px', minWidth: 0 }}
            >
              {columnQuickFindContent}
            </div>
          ) : null}
          <div
            data-grid-legacy-page-find="true"
            style={{ display: 'flex', flex: '0 1 auto', minWidth: 0 }}
          >
            {pageFindContent}
          </div>
          <div
            data-grid-legacy-pagination="true"
            style={{ display: 'flex', minWidth: 0, marginLeft: 'auto' }}
          >
            {paginationContent}
          </div>
        </div>
      </div>
    </>
  );
};

export default DataGridSecondaryActions;
