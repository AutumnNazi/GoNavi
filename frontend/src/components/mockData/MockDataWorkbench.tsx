import React, { useCallback } from 'react';
import { Alert, Button, Checkbox, InputNumber, Space, Spin, Tooltip, Typography } from 'antd';
import { ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import type { TabData } from '../../types';
import { useMockDataSetup } from './hooks/useMockDataSetup';
import { useMockDataRun } from './hooks/useMockDataRun';
import { MockDataColumnTable } from './MockDataColumnTable';
import { MockDataPreviewPanel } from './MockDataPreviewPanel';
import { MockDataRunPanel } from './MockDataRunPanel';
import type { MockDataKind } from './mockDataModel';
import './MockDataWorkbench.css';

export interface MockDataWorkbenchProps { tab: TabData }

/** 模拟数据工作台：按列配置生成规则，预览后批量写入目标表。 */
const MockDataWorkbench: React.FC<MockDataWorkbenchProps> = ({ tab }) => {
  const setup = useMockDataSetup({ tab });
  const run = useMockDataRun(setup);
  const { t, loadState, target, columns, columnInfoByName, updateColumn, updateGenerator, changeKind } = setup;
  const busy = run.running;

  const handleToggle = useCallback((name: string, enabled: boolean) => updateColumn(name, { skip: !enabled }), [updateColumn]);
  const handleKind = useCallback((name: string, kind: MockDataKind) => changeKind(name, kind), [changeKind]);
  const handleNullRatio = useCallback((name: string, ratio: number) => updateColumn(name, { nullRatio: ratio }), [updateColumn]);

  return (
    <div className="gn-mock-data-workbench" data-mock-data-workbench="true">
      <header className="gn-mock-data-header">
        <div className="gn-mock-data-heading">
          <Typography.Title level={4} style={{ margin: 0 }}>{t('mock_data.workbench.title')}</Typography.Title>
          <Typography.Text type="secondary">
            {target ? t('mock_data.workbench.target', { database: target.dbName || '-', table: target.tableName }) : t('mock_data.workbench.description')}
          </Typography.Text>
        </div>
        <Space wrap>
          <Button onClick={setup.resetSuggestions} disabled={busy || loadState.status !== 'ready'}>{t('mock_data.workbench.reset')}</Button>
          <Button onClick={() => { void run.runPreview(); }} loading={run.preview.status === 'loading'} disabled={busy || loadState.status !== 'ready'}>
            {t('mock_data.workbench.preview')}
          </Button>
          <Button type="primary" danger onClick={() => { void run.runGenerate(); }} loading={busy} disabled={loadState.status !== 'ready'}>
            {t('mock_data.workbench.generate')}
          </Button>
        </Space>
      </header>

      <div className="gn-mock-data-toolbar">
        <Space wrap size={16}>
          <Space size={6}>
            <Typography.Text>{t('mock_data.workbench.row_count')}</Typography.Text>
            <InputNumber min={1} max={setup.maxRowCount} value={setup.rowCount} disabled={busy}
              onChange={(value) => setup.setRowCount(Math.min(Math.max(Number(value ?? 1), 1), setup.maxRowCount))} style={{ width: 140 }} />
          </Space>
          <Space size={6}>
            <Tooltip title={t('mock_data.workbench.seed_hint')}>
              <Typography.Text>{t('mock_data.workbench.seed')}</Typography.Text>
            </Tooltip>
            <InputNumber min={1} max={2_147_483_647} value={setup.seed} disabled={busy}
              onChange={(value) => setup.setSeed(Math.max(Number(value ?? 1), 1))} style={{ width: 150 }} />
            <Button icon={<SyncOutlined />} disabled={busy} onClick={setup.rerollSeed} aria-label={t('mock_data.workbench.reroll_seed')} />
          </Space>
          <Checkbox checked={setup.continueOnError} disabled={busy} onChange={(event) => setup.setContinueOnError(event.target.checked)}>
            {t('mock_data.workbench.continue_on_error')}
          </Checkbox>
        </Space>
      </div>

      <MockDataRunPanel running={run.running} progress={run.progress} outcome={run.outcome} t={t} onCancel={run.cancel} onDismiss={run.clearOutcome} />

      <div className="gn-mock-data-body">
        {loadState.status === 'loading' ? (
          <div className="gn-mock-data-loading">
            <Spin />
            <Typography.Text type="secondary">{t('mock_data.workbench.loading')}</Typography.Text>
          </div>
        ) : null}
        {loadState.status === 'error' ? (
          <Alert type="error" showIcon message={t('mock_data.workbench.load_failed')} description={loadState.message}
            action={<Button size="small" icon={<ReloadOutlined />} onClick={setup.reload}>{t('common.retry')}</Button>} />
        ) : null}
        {loadState.status === 'ready' ? (
          <>
            <section className="gn-mock-data-section">
              <Typography.Text strong>{t('mock_data.workbench.columns_title')}</Typography.Text>
              <MockDataColumnTable columns={columns} infoByName={columnInfoByName} disabled={busy} t={t}
                onToggle={handleToggle} onKindChange={handleKind} onGeneratorChange={updateGenerator} onNullRatioChange={handleNullRatio} />
            </section>
            <section className="gn-mock-data-section">
              <Typography.Text strong>{t('mock_data.workbench.preview_title')}</Typography.Text>
              <MockDataPreviewPanel preview={run.preview} t={t} />
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
};

export default MockDataWorkbench;
