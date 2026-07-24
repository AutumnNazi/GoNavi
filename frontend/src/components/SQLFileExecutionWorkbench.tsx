import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Empty, Progress, Typography } from 'antd';
import {
  ClockCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
  StopOutlined,
} from '@ant-design/icons';

import { ExecuteSQLFile, CancelSQLFileExecution } from '../../wailsjs/go/app/App';
import { useStore } from '../store';
import type { TabData } from '../types';
import { t } from '../i18n';
import { buildRpcConnectionConfig } from '../utils/connectionRpcConfig';
import { resolveConnectionHostSummary } from '../utils/tabDisplay';
import { formatExportElapsed, resolveExportElapsedMs } from '../utils/exportProgress';
import {
  useSQLFileExecutionRunner,
  type SQLFileExecutionRunnerStatus,
  type SQLFileExecutionState,
} from './useSQLFileExecutionRunner';

const { Paragraph, Text, Title } = Typography;

type SQLFileExecutionHistoryEntry = SQLFileExecutionState & {
  requestKey: string;
};

const EMPTY_HISTORY: SQLFileExecutionHistoryEntry[] = [];

const formatDateTime = (timestamp: number): string => {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return '-';
  }
  return new Date(timestamp).toLocaleString('zh-CN', { hour12: false });
};

const resolveStatusMeta = (status: SQLFileExecutionRunnerStatus): {
  label: string;
  border: string;
  bg: string;
  text: string;
} => {
  const meta: Record<SQLFileExecutionRunnerStatus, { label: string; border: string; bg: string; text: string }> = {
    idle: {
      label: t('sidebar.sql_file_exec.workbench.empty.not_started'),
      border: 'rgba(148, 163, 184, 0.35)',
      bg: 'rgba(148, 163, 184, 0.12)',
      text: '#475467',
    },
    start: {
      label: t('sidebar.sql_file_exec.workbench.stage.preparing'),
      border: 'rgba(59, 130, 246, 0.3)',
      bg: 'rgba(59, 130, 246, 0.12)',
      text: '#1d4ed8',
    },
    running: {
      label: t('sidebar.sql_file_exec.status.running'),
      border: 'rgba(16, 185, 129, 0.3)',
      bg: 'rgba(16, 185, 129, 0.14)',
      text: '#047857',
    },
    done: {
      label: t('sidebar.sql_file_exec.status.done'),
      border: 'rgba(34, 197, 94, 0.3)',
      bg: 'rgba(34, 197, 94, 0.14)',
      text: '#15803d',
    },
    cancelled: {
      label: t('sidebar.sql_file_exec.status.cancelled'),
      border: 'rgba(249, 115, 22, 0.3)',
      bg: 'rgba(249, 115, 22, 0.12)',
      text: '#c2410c',
    },
    error: {
      label: t('sidebar.sql_file_exec.status.error'),
      border: 'rgba(239, 68, 68, 0.32)',
      bg: 'rgba(239, 68, 68, 0.12)',
      text: '#dc2626',
    },
  };
  return meta[status];
};

const renderStatusPill = (status: SQLFileExecutionRunnerStatus) => {
  const meta = resolveStatusMeta(status);
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '4px 10px',
        borderRadius: 999,
        border: `1px solid ${meta.border}`,
        background: meta.bg,
        color: meta.text,
        fontSize: 12,
        lineHeight: 1.2,
        fontWeight: 600,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  );
};

const formatExecutionSummary = (executed: number, failed: number): string =>
  `${t('sidebar.sql_file_exec.executed_label')}${executed.toLocaleString()}${t('sidebar.sql_file_exec.rows_separator')}${failed.toLocaleString()}${t('sidebar.sql_file_exec.rows_suffix')}`;

const resolveProgressStatus = (status: SQLFileExecutionRunnerStatus): 'active' | 'success' | 'exception' | 'normal' => {
  if (status === 'done') return 'success';
  if (status === 'error') return 'exception';
  if (status === 'start' || status === 'running') return 'active';
  return 'normal';
};

const SQLFileExecutionWorkbench: React.FC<{ tab: TabData }> = ({ tab }) => {
  const connections = useStore((state) => state.connections);
  const theme = useStore((state) => state.theme);
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [historyEntries, setHistoryEntries] = useState<SQLFileExecutionHistoryEntry[]>(EMPTY_HISTORY);
  const lastRequestKeyRef = useRef('');
  const darkMode = theme === 'dark';
  const shellBg = darkMode ? '#101319' : '#f5f7fb';
  const panelBg = darkMode ? '#161b22' : '#ffffff';
  const panelBorder = darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(15,23,42,0.08)';
  const dividerColor = darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.08)';
  const headingColor = darkMode ? 'rgba(255,255,255,0.96)' : '#101828';
  const secondaryTextColor = darkMode ? 'rgba(255,255,255,0.68)' : '#667085';
  const subtleBg = darkMode ? 'rgba(255,255,255,0.04)' : '#f8fafc';
  const connection = useMemo(
    () => connections.find((item) => item.id === String(tab.connectionId || '').trim()),
    [connections, tab.connectionId],
  );
  const connectionConfig = useMemo(
    () => (connection ? buildRpcConnectionConfig(connection.config) : null),
    [connection],
  );
  const hostSummary = useMemo(
    () => resolveConnectionHostSummary(connection?.config),
    [connection?.config],
  );
  const { state, reset, cancelExecution, runSQLFileExecutionWithProgress, isRunning } = useSQLFileExecutionRunner({
    showToast: true,
  });

  useEffect(() => {
    if (!state.startedAt || state.finishedAt > 0) {
      return undefined;
    }
    const timer = globalThis.setInterval(() => {
      setNowTick(Date.now());
    }, 1000);
    return () => {
      globalThis.clearInterval(timer);
    };
  }, [state.finishedAt, state.startedAt]);

  useEffect(() => {
    if (!state.jobId) {
      return;
    }
    if (state.status !== 'done' && state.status !== 'cancelled' && state.status !== 'error') {
      return;
    }
    setHistoryEntries((prev) => [
      {
        ...state,
        requestKey: String(tab.sqlFileExecutionRequestKey || '').trim(),
      },
      ...prev.filter((entry) => entry.jobId !== state.jobId),
    ].slice(0, 10));
  }, [state, tab.sqlFileExecutionRequestKey]);

  const startExecution = React.useCallback(async () => {
    const filePath = String(tab.filePath || '').trim();
    if (!connectionConfig || !filePath) {
      return;
    }
    await runSQLFileExecutionWithProgress({
      title: tab.title || t('sidebar.sql_file_exec.title'),
      filePath,
      fileSizeMB: tab.sqlFileExecutionFileSizeMB,
      run: (jobId) => ExecuteSQLFile(connectionConfig as any, tab.dbName || '', filePath, jobId),
      cancel: (jobId) => {
        CancelSQLFileExecution(jobId);
      },
    });
  }, [
    connectionConfig,
    runSQLFileExecutionWithProgress,
    tab.dbName,
    tab.filePath,
    tab.sqlFileExecutionFileSizeMB,
    tab.title,
  ]);

  useEffect(() => {
    const requestKey = String(tab.sqlFileExecutionRequestKey || '').trim();
    if (!requestKey || requestKey === lastRequestKeyRef.current) {
      return;
    }
    if (!connectionConfig || !String(tab.filePath || '').trim()) {
      return;
    }
    lastRequestKeyRef.current = requestKey;
    void startExecution();
  }, [connectionConfig, startExecution, tab.filePath, tab.sqlFileExecutionRequestKey]);

  const currentElapsedMs = useMemo(
    () => resolveExportElapsedMs(state.startedAt, state.finishedAt, nowTick),
    [nowTick, state.finishedAt, state.startedAt],
  );
  const progressPercent = Math.max(0, Math.min(100, Number(state.percent) || 0));
  const currentSummary = formatExecutionSummary(state.executed, state.failed);
  const historyList = useMemo(
    () => historyEntries.filter((entry) => entry.jobId !== state.jobId),
    [historyEntries, state.jobId],
  );

  return (
    <div
      data-sql-file-execution-workbench="true"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        background: shellBg,
        color: headingColor,
      }}
    >
      <div style={{ padding: '18px 22px 10px' }}>
        <Title level={4} style={{ margin: 0, color: headingColor }}>
          {t('sidebar.sql_file_exec.title')}
        </Title>
        <div style={{ marginTop: 6, color: secondaryTextColor, fontSize: 13 }}>
          {t('sidebar.sql_file_exec.workbench.helper.auto_run')}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(280px, 360px) minmax(0, 1fr)',
          gap: 20,
          padding: '0 22px 22px',
          flex: 1,
          minHeight: 0,
        }}
      >
        <section
          style={{
            padding: 20,
            borderRadius: 8,
            background: panelBg,
            border: panelBorder,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
            minHeight: 0,
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: headingColor, marginBottom: 10 }}>
              {t('sidebar.sql_file_exec.workbench.section.config')}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '96px minmax(0, 1fr)', rowGap: 8, columnGap: 10 }}>
              <Text type="secondary">{t('data_export.label.connection')}</Text>
              <Text>{connection?.name || '-'}</Text>

              <Text type="secondary">{t('data_export.label.database')}</Text>
              <Text>{tab.dbName || '-'}</Text>

              <Text type="secondary">{t('sidebar.sql_file_exec.workbench.label.file_path')}</Text>
              <Paragraph style={{ marginBottom: 0, wordBreak: 'break-all' }}>
                {tab.filePath || '-'}
              </Paragraph>

              <Text type="secondary">{t('sidebar.sql_file_exec.file_size').replace(/[:：]\s*$/, '')}</Text>
              <Text>{tab.sqlFileExecutionFileSizeMB ? `${tab.sqlFileExecutionFileSizeMB} MB` : '-'}</Text>

              <Text type="secondary">{t('data_export.label.host')}</Text>
              <Text>{hostSummary || '-'}</Text>
            </div>
          </div>

          {!connectionConfig ? (
            <Alert
              type="warning"
              showIcon
              message={t('sidebar.message.connection_config_not_found')}
            />
          ) : null}

          <div
            style={{
              marginTop: 'auto',
              padding: 14,
              borderRadius: 8,
              background: subtleBg,
              border: `1px solid ${dividerColor}`,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 12, color: secondaryTextColor }}>
              {t('sidebar.sql_file_exec.workbench.helper.reuse')}
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {isRunning ? (
                <Button danger icon={<StopOutlined />} onClick={() => void cancelExecution()}>
                  {t('sidebar.sql_file_exec.cancel')}
                </Button>
              ) : (
                <Button
                  type="primary"
                  icon={state.status === 'idle' ? <FileTextOutlined /> : <ReloadOutlined />}
                  disabled={!connectionConfig || !String(tab.filePath || '').trim()}
                  onClick={() => {
                    void startExecution();
                  }}
                >
                  {t('sidebar.sql_file_exec.workbench.action.run_again')}
                </Button>
              )}
              {(state.status === 'done' || state.status === 'cancelled' || state.status === 'error') ? (
                <Button icon={<ReloadOutlined />} onClick={reset}>
                  {t('data_export.action.clear_progress')}
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, minWidth: 0, minHeight: 0 }}>
          <section
            style={{
              padding: 20,
              borderRadius: 8,
              background: panelBg,
              border: panelBorder,
              display: 'flex',
              flexDirection: 'column',
              gap: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: headingColor }}>
                    {t('data_export.workbench.section.current_task')}
                  </div>
                  {renderStatusPill(state.status)}
                </div>
                <Title level={5} style={{ margin: '10px 0 0', color: headingColor }}>
                  {state.title || tab.title || t('sidebar.sql_file_exec.title')}
                </Title>
                <div style={{ marginTop: 6, color: secondaryTextColor, fontSize: 13 }}>
                  {state.jobId ? `${state.filePath || tab.filePath || '-'} · ${currentSummary}` : t('sidebar.sql_file_exec.workbench.description.current_task_empty')}
                </div>
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, minmax(120px, auto))',
                  gap: '12px 18px',
                  alignSelf: 'stretch',
                }}
              >
                <div>
                  <div style={{ fontSize: 12, color: secondaryTextColor, marginBottom: 4 }}>
                    {t('sidebar.sql_file_exec.workbench.label.elapsed')}
                  </div>
                  <div style={{ color: headingColor, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <ClockCircleOutlined />
                    {state.startedAt ? formatExportElapsed(currentElapsedMs) : '--:--'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: secondaryTextColor, marginBottom: 4 }}>
                    {t('sidebar.sql_file_exec.workbench.label.started_at')}
                  </div>
                  <div style={{ color: headingColor, fontWeight: 600 }}>{formatDateTime(state.startedAt)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: secondaryTextColor, marginBottom: 4 }}>
                    {t('sidebar.sql_file_exec.workbench.label.file_path')}
                  </div>
                  <div style={{ color: headingColor, fontWeight: 600, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {state.filePath || tab.filePath || '-'}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 12, color: secondaryTextColor, marginBottom: 4 }}>
                    {t('sidebar.sql_file_exec.workbench.label.progress_summary')}
                  </div>
                  <div style={{ color: headingColor, fontWeight: 600 }}>{state.jobId ? currentSummary : '-'}</div>
                </div>
              </div>
            </div>

            {state.jobId ? (
              <>
                <div>
                  <Progress
                    percent={Math.round(progressPercent)}
                    status={resolveProgressStatus(state.status)}
                    strokeColor={state.status === 'cancelled' ? '#faad14' : undefined}
                  />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 0.9fr)', gap: 18 }}>
                  <div>
                    <div style={{ fontSize: 12, color: secondaryTextColor, marginBottom: 6 }}>
                      {t('sidebar.sql_file_exec.workbench.label.current_stage')}
                    </div>
                    <Text>{state.stage || resolveStatusMeta(state.status).label}</Text>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, color: secondaryTextColor, marginBottom: 6 }}>
                      {t('sidebar.sql_file_exec.workbench.label.file_path')}
                    </div>
                    <Paragraph style={{ marginBottom: 0, wordBreak: 'break-all' }}>
                      {state.filePath || '-'}
                    </Paragraph>
                  </div>
                </div>

                {state.currentSQL ? (
                  <div>
                    <div style={{ fontSize: 12, color: secondaryTextColor, marginBottom: 6 }}>
                      {t('sidebar.sql_file_exec.workbench.label.current_sql')}
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        color: secondaryTextColor,
                        background: subtleBg,
                        borderRadius: 8,
                        padding: '10px 12px',
                        fontFamily: 'var(--gn-font-mono)',
                        wordBreak: 'break-all',
                        maxHeight: 96,
                        overflow: 'auto',
                      }}
                    >
                      {state.currentSQL}
                    </div>
                  </div>
                ) : null}

                {state.message ? (
                  <Alert
                    type={state.status === 'error' ? 'error' : state.status === 'cancelled' ? 'warning' : 'info'}
                    showIcon
                    message={state.message}
                  />
                ) : null}
              </>
            ) : (
              <div>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={t('sidebar.sql_file_exec.workbench.empty.not_started')}
                />
              </div>
            )}
          </section>

          <section
            style={{
              padding: 20,
              borderRadius: 8,
              background: panelBg,
              border: panelBorder,
              display: 'flex',
              flexDirection: 'column',
              gap: 14,
              minHeight: 0,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: headingColor }}>
                  {t('data_export.workbench.section.history')}
                </div>
                <div style={{ marginTop: 4, fontSize: 12, color: secondaryTextColor }}>
                  {t('sidebar.sql_file_exec.workbench.empty.history')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ color: secondaryTextColor, fontSize: 12 }}>
                  {historyList.length.toLocaleString()}
                </div>
                {historyList.length > 0 ? (
                  <Button size="small" type="text" onClick={() => setHistoryEntries(EMPTY_HISTORY)}>
                    {t('sidebar.sql_file_exec.workbench.action.clear_history')}
                  </Button>
                ) : null}
              </div>
            </div>

            {historyList.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'auto' }}>
                {historyList.map((entry, index) => {
                  const elapsed = formatExportElapsed(resolveExportElapsedMs(entry.startedAt, entry.finishedAt, nowTick));
                  return (
                    <div
                      key={entry.jobId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 0.85fr)',
                        gap: 18,
                        padding: '14px 0',
                        borderTop: index === 0 ? 'none' : `1px solid ${dividerColor}`,
                      }}
                    >
                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                          <Text strong>{entry.title || tab.title}</Text>
                          {renderStatusPill(entry.status)}
                          <span style={{ fontSize: 12, color: secondaryTextColor }}>
                            {formatExecutionSummary(entry.executed, entry.failed)}
                          </span>
                        </div>
                        <div style={{ marginTop: 6, fontSize: 13, color: headingColor }}>
                          {entry.stage || resolveStatusMeta(entry.status).label}
                        </div>
                        {entry.message ? (
                          <div style={{ marginTop: 8, fontSize: 12, color: entry.status === 'error' ? '#dc2626' : secondaryTextColor, whiteSpace: 'pre-wrap' }}>
                            {entry.message}
                          </div>
                        ) : null}
                      </div>

                      <div style={{ minWidth: 0 }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '84px minmax(0, 1fr)', rowGap: 6, columnGap: 10 }}>
                          <Text type="secondary">{t('sidebar.sql_file_exec.workbench.label.started_at')}</Text>
                          <Text>{formatDateTime(entry.startedAt)}</Text>

                          <Text type="secondary">{t('sidebar.sql_file_exec.workbench.label.elapsed')}</Text>
                          <Text>{elapsed}</Text>

                          <Text type="secondary">{t('sidebar.sql_file_exec.workbench.label.file_path')}</Text>
                          <Paragraph style={{ marginBottom: 0, wordBreak: 'break-all' }}>
                            {entry.filePath || '-'}
                          </Paragraph>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ padding: '6px 0 2px', color: secondaryTextColor, fontSize: 13 }}>
                {t('sidebar.sql_file_exec.workbench.empty.history')}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default SQLFileExecutionWorkbench;
