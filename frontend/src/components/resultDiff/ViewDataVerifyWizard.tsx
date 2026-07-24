import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Checkbox,
  Input,
  InputNumber,
  Select,
  Space,
  Steps,
  Typography,
  message,
} from 'antd';
import Modal from '../common/ResizableDraggableModal';
import { DBQuery } from '../../../wailsjs/go/app/App';
import { t as defaultTranslate } from '../../i18n';
import { useOptionalI18n } from '../../i18n/provider';
import { quoteQualifiedIdent } from '../../utils/sql';
import {
  runResultDiffCompare,
  suggestKeyColumns,
} from '../../utils/resultDiff/client';
import { resolveResultDiffColumnMeta } from '../../utils/resultDiff/columnMeta';
import { collectExportColumns } from '../../utils/resultDiff/exportDiff';
import type {
  ResultDiffColumnMeta,
  ResultDiffComparableResult,
  ResultDiffCompareOptions,
  ResultDiffSummary,
} from '../../utils/resultDiff/types';
import {
  assessViewBodyComplexity,
  buildDryRunSqlCandidates,
  buildViewSnapshotSelectSql,
  extractViewSelectBody,
  type ViewVerifyMode,
} from '../../utils/resultDiff/viewDataVerify';

type QueryResultLike = {
  success?: boolean;
  Success?: boolean;
  message?: string;
  Message?: string;
  data?: unknown;
  Data?: unknown;
  fields?: string[];
  Fields?: string[];
};

export type ViewDataVerifyWizardProps = {
  open: boolean;
  connectionConfig: unknown;
  database: string;
  dbType: string;
  viewName: string;
  /** 编辑器中的 CREATE VIEW DDL */
  ddlSql: string;
  /** 可选：库中旧定义 SQL（含 CREATE），用于 dry-run；为空则 dry-run 时再尝试不依赖 */
  previousDefinitionSql?: string;
  onCancel: () => void;
  onCompleted: (payload: {
    jobId: string;
    summary: ResultDiffSummary;
    leftLabel: string;
    rightLabel: string;
    columnMeta?: Record<string, ResultDiffColumnMeta>;
  }) => void;
};

const isSuccess = (res: QueryResultLike) => Boolean(res?.success ?? res?.Success);
const messageOf = (res: QueryResultLike) => String(res?.message ?? res?.Message ?? '');
const dataOf = (res: QueryResultLike) => res?.data ?? res?.Data;
const fieldsOf = (res: QueryResultLike): string[] => {
  const f = res?.fields ?? res?.Fields;
  return Array.isArray(f) ? f.map(String) : [];
};

const toRows = (data: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(data)) return [];
  return data
    .filter((row) => row && typeof row === 'object' && !Array.isArray(row))
    .map((row) => row as Record<string, unknown>);
};

const sanitizeRows = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
  rows.map((row) => {
    const next: Record<string, unknown> = {};
    Object.entries(row || {}).forEach(([k, v]) => {
      if (k === '__gonavi_row_key' || k === 'GONAVI_ROW_KEY') return;
      next[k] = v;
    });
    return next;
  });

const ViewDataVerifyWizard: React.FC<ViewDataVerifyWizardProps> = ({
  open,
  connectionConfig,
  database,
  dbType,
  viewName,
  ddlSql,
  previousDefinitionSql,
  onCancel,
  onCompleted,
}) => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? defaultTranslate;

  const [mode, setMode] = useState<ViewVerifyMode>('apply');
  const [whereClause, setWhereClause] = useState('');
  const [keyColumns, setKeyColumns] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [maxRowsPerSide, setMaxRowsPerSide] = useState(50000);
  const [options, setOptions] = useState<ResultDiffCompareOptions>({
    trimStrings: true,
    ignoreCase: false,
    nullEqualsEmpty: false,
  });
  const [probing, setProbing] = useState(false);
  const [running, setRunning] = useState(false);
  const [step, setStep] = useState(0);
  const [statusText, setStatusText] = useState('');

  const quotedView = useMemo(
    () => quoteQualifiedIdent(dbType || '', viewName),
    [dbType, viewName],
  );

  const snapshotSql = useMemo(
    () => buildViewSnapshotSelectSql(quotedView, whereClause),
    [quotedView, whereClause],
  );

  useEffect(() => {
    if (!open) return;
    setMode('apply');
    setWhereClause('');
    setKeyColumns([]);
    setColumns([]);
    setMaxRowsPerSide(50000);
    setOptions({ trimStrings: true, ignoreCase: false, nullEqualsEmpty: false });
    setStep(0);
    setStatusText('');
    setRunning(false);

    let cancelled = false;
    const probe = async () => {
      if (!viewName || !connectionConfig) return;
      setProbing(true);
      try {
        // 尽量轻量：带 WHERE 1=0；失败再试 LIMIT 1
        const candidates = [
          `SELECT * FROM ${quotedView} WHERE 1=0`,
          `SELECT * FROM ${quotedView} WHERE 1=0`,
        ];
        // SQL Server 等不支持 WHERE 1=0 时用 TOP/LIMIT
        const db = (dbType || '').toLowerCase();
        if (db === 'sqlserver' || db === 'mssql') {
          candidates.unshift(`SELECT TOP 0 * FROM ${quotedView}`);
          candidates.push(`SELECT TOP 1 * FROM ${quotedView}`);
        } else if (db === 'oracle') {
          candidates.unshift(`SELECT * FROM ${quotedView} WHERE 1=0`);
          candidates.push(`SELECT * FROM ${quotedView} WHERE ROWNUM <= 1`);
        } else {
          candidates.push(`SELECT * FROM ${quotedView} LIMIT 1`);
        }

        let cols: string[] = [];
        let sample: Record<string, unknown>[] = [];
        for (const sql of candidates) {
          const res = (await DBQuery(connectionConfig as any, database, sql)) as QueryResultLike;
          if (!isSuccess(res)) continue;
          const rows = toRows(dataOf(res));
          cols = fieldsOf(res);
          if (cols.length === 0 && rows[0]) {
            cols = Object.keys(rows[0]);
          }
          if (cols.length > 0) {
            sample = rows;
            break;
          }
        }
        if (cancelled) return;
        setColumns(cols);
        if (cols.length > 0) {
          const left: ResultDiffComparableResult = {
            key: 'probe-l',
            label: 'L',
            sql: '',
            columns: cols,
            rows: sample,
            pkColumns: [],
          };
          const right: ResultDiffComparableResult = {
            key: 'probe-r',
            label: 'R',
            sql: '',
            columns: cols,
            rows: sample,
            pkColumns: [],
          };
          setKeyColumns(suggestKeyColumns(left, right));
        }
      } catch {
        // 探测失败不阻塞，用户可手填 key（若无列则仍需先探测）
      } finally {
        if (!cancelled) setProbing(false);
      }
    };
    void probe();
    return () => {
      cancelled = true;
    };
  }, [open, viewName, quotedView, connectionConfig, database, dbType]);

  const loadSide = async (sql: string, sideLabel: string): Promise<ResultDiffComparableResult> => {
    setStatusText(t('result_diff.view_verify.status.loading_side', { side: sideLabel }));
    const res = (await DBQuery(connectionConfig as any, database, sql)) as QueryResultLike;
    if (!isSuccess(res)) {
      throw new Error(messageOf(res) || `load ${sideLabel} failed`);
    }
    let rows = sanitizeRows(toRows(dataOf(res)));
    let cols = fieldsOf(res);
    if (cols.length === 0 && rows[0]) {
      cols = Object.keys(rows[0]);
    }
    if (maxRowsPerSide > 0 && rows.length > maxRowsPerSide) {
      throw new Error(
        t('result_diff.view_verify.error.row_limit', {
          side: sideLabel,
          count: String(rows.length),
          maxRows: String(maxRowsPerSide),
        }),
      );
    }
    return {
      key: sideLabel,
      label: sideLabel,
      sql,
      columns: cols,
      rows,
      truncated: false,
    };
  };

  /** 按候选 SQL 顺序尝试装载，用于复杂视图 dry-run 方言回退 */
  const loadSideWithCandidates = async (
    candidates: { sql: string; label: string }[],
    sideLabel: string,
  ): Promise<ResultDiffComparableResult & { usedStrategyLabel: string }> => {
    if (candidates.length === 0) {
      throw new Error(t('result_diff.view_verify.error.extract_new_body'));
    }
    const errors: string[] = [];
    for (const candidate of candidates) {
      try {
        setStatusText(
          t('result_diff.view_verify.status.loading_side_strategy', {
            side: sideLabel,
            strategy: candidate.label,
          }),
        );
        const loaded = await loadSide(candidate.sql, sideLabel);
        return { ...loaded, usedStrategyLabel: candidate.label };
      } catch (error: any) {
        errors.push(`[${candidate.label}] ${error?.message || String(error)}`);
      }
    }
    throw new Error(
      t('result_diff.view_verify.error.dry_run_all_failed', {
        side: sideLabel,
        detail: errors.slice(0, 4).join(' | '),
      }),
    );
  };

  const executeDdl = async () => {
    setStatusText(t('result_diff.view_verify.status.applying_ddl'));
    const sql = String(ddlSql || '').trim();
    if (!sql) {
      throw new Error(t('result_diff.view_verify.error.ddl_empty'));
    }
    const res = (await DBQuery(connectionConfig as any, database, sql)) as QueryResultLike;
    if (!isSuccess(res)) {
      throw new Error(messageOf(res) || t('result_diff.view_verify.error.ddl_failed'));
    }
  };

  const loadColumnMetaForSummary = async (
    summary: ResultDiffSummary,
    left?: ResultDiffComparableResult,
    right?: ResultDiffComparableResult,
  ): Promise<Record<string, ResultDiffColumnMeta>> => {
    try {
      const names = collectExportColumns(summary, []);
      return await resolveResultDiffColumnMeta({
        connectionConfig,
        database,
        left: left || {
          key: 'l',
          label: 'L',
          sql: snapshotSql,
          columns: names,
          rows: [],
          metadataDbName: database,
          metadataTableName: viewName,
        },
        right: right || {
          key: 'r',
          label: 'R',
          sql: snapshotSql,
          columns: names,
          rows: [],
          metadataDbName: database,
          metadataTableName: viewName,
        },
        columnNames: names.length > 0 ? names : (summary.commonColumns || summary.keyColumns || []),
      });
    } catch {
      return {};
    }
  };

  const runApplyFlow = async () => {
    setStep(1);
    const left = await loadSide(snapshotSql, t('result_diff.view_verify.label.before'));
    if (left.columns.length > 0) {
      setColumns(left.columns);
    }
    let keys = keyColumns.length > 0 ? [...keyColumns] : suggestKeyColumns(left, left);
    if (keys.length === 0 && left.columns[0]) {
      keys = [left.columns[0]];
    }
    if (keys.length === 0) {
      throw new Error(t('result_diff.wizard.need_keys'));
    }

    setStep(2);
    setStatusText(t('result_diff.view_verify.status.confirm_ddl'));
    // 确认是否执行 DDL
    const confirmed = await new Promise<boolean>((resolve) => {
      Modal.confirm({
        title: t('result_diff.view_verify.confirm_ddl.title'),
        content: t('result_diff.view_verify.confirm_ddl.content', { view: viewName }),
        okText: t('result_diff.view_verify.confirm_ddl.ok'),
        cancelText: t('common.cancel'),
        onOk: () => resolve(true),
        onCancel: () => resolve(false),
      });
    });
    if (!confirmed) {
      throw new Error(t('result_diff.view_verify.error.cancelled'));
    }

    try {
      await executeDdl();
    } catch (ddlError) {
      // 改前快照已拿到，但 DDL 失败：明确提示用户可单独重试 DDL
      throw new Error(
        `${t('result_diff.view_verify.error.ddl_failed')}: ${
          ddlError instanceof Error ? ddlError.message : String(ddlError)
        }`,
      );
    }

    setStep(3);
    const right = await loadSide(snapshotSql, t('result_diff.view_verify.label.after'));

    setStep(4);
    setStatusText(t('result_diff.view_verify.status.diffing'));

    const { jobId, summary } = await runResultDiffCompare({
      config: connectionConfig,
      database,
      left,
      right,
      keyColumns: keys,
      mode: 'rows',
      options,
      maxRowsPerSide: maxRowsPerSide > 0 ? maxRowsPerSide : undefined,
    });

    const columnMeta = await loadColumnMetaForSummary(summary, left, right);
    onCompleted({
      jobId,
      summary,
      leftLabel: t('result_diff.view_verify.label.before'),
      rightLabel: t('result_diff.view_verify.label.after'),
      columnMeta,
    });
  };

  const runDryRunFlow = async () => {
    setStep(1);
    setStatusText(t('result_diff.view_verify.status.dry_run_prepare'));
    const newBody = extractViewSelectBody(ddlSql);
    if (!newBody) {
      throw new Error(t('result_diff.view_verify.error.extract_new_body'));
    }

    const complexity = assessViewBodyComplexity(newBody);
    if (complexity.level === 'complex') {
      message.warning(t('result_diff.view_verify.warning.complex_body'));
    }

    // 左侧：优先当前库视图快照（最稳）；若有旧 DDL 再追加 body 包装候选
    const oldBody = extractViewSelectBody(previousDefinitionSql || '');
    const leftCandidates = buildDryRunSqlCandidates({
      selectBody: oldBody,
      alias: 'gn_view_old',
      dbType,
      whereClause,
      preferredLiveViewSql: snapshotSql,
    });
    // 右侧：编辑器定义 body 的多策略包装（derived → cte → …）
    const rightCandidates = buildDryRunSqlCandidates({
      selectBody: newBody,
      alias: 'gn_view_new',
      dbType,
      whereClause,
    });

    setStep(2);
    const leftLoaded = await loadSideWithCandidates(
      leftCandidates,
      t('result_diff.view_verify.label.before'),
    );
    const rightLoaded = await loadSideWithCandidates(
      rightCandidates,
      t('result_diff.view_verify.label.after_def'),
    );

    let keys = [...keyColumns];
    if (keys.length === 0) {
      keys = suggestKeyColumns(leftLoaded, rightLoaded);
      if (keys.length === 0 && leftLoaded.columns[0]) {
        keys = [leftLoaded.columns[0]];
      }
    }
    if (keys.length === 0) {
      throw new Error(t('result_diff.wizard.need_keys'));
    }

    setStep(3);
    setStatusText(t('result_diff.view_verify.status.diffing'));

    // 使用已成功装载的行做快照比对，避免服务端再次按单一 SQL 方言路径失败
    const { jobId, summary } = await runResultDiffCompare({
      config: connectionConfig,
      database,
      left: leftLoaded,
      right: rightLoaded,
      keyColumns: keys,
      mode: 'rows',
      options,
      maxRowsPerSide: maxRowsPerSide > 0 ? maxRowsPerSide : undefined,
    });

    if (leftLoaded.usedStrategyLabel !== 'live_view' || rightLoaded.usedStrategyLabel !== 'derived') {
      message.info(
        t('result_diff.view_verify.info.strategy_used', {
          left: leftLoaded.usedStrategyLabel,
          right: rightLoaded.usedStrategyLabel,
        }),
      );
    }

    const columnMeta = await loadColumnMetaForSummary(summary, leftLoaded, rightLoaded);
    onCompleted({
      jobId,
      summary,
      leftLabel: t('result_diff.view_verify.label.before'),
      rightLabel: t('result_diff.view_verify.label.after_def'),
      columnMeta,
    });
  };

  const handleStart = async () => {
    if (!viewName) {
      message.warning(t('result_diff.view_verify.error.no_view_name'));
      return;
    }
    if (keyColumns.length === 0 && columns.length > 0) {
      message.warning(t('result_diff.wizard.need_keys'));
      return;
    }
    setRunning(true);
    setStep(0);
    try {
      if (mode === 'apply') {
        await runApplyFlow();
      } else {
        await runDryRunFlow();
      }
    } catch (error: any) {
      const msg = error?.message || String(error);
      if (msg !== t('result_diff.view_verify.error.cancelled')) {
        message.error(msg);
      }
    } finally {
      setRunning(false);
      setStatusText('');
    }
  };

  return (
    <Modal
      title={t('result_diff.view_verify.title')}
      open={open}
      onCancel={running ? undefined : onCancel}
      onOk={handleStart}
      okText={t('result_diff.view_verify.start')}
      confirmLoading={running || probing}
      destroyOnClose
      width={680}
      maskClosable={!running}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message={t('result_diff.view_verify.view_name', { name: viewName || '-' })}
          description={
            mode === 'apply'
              ? t('result_diff.view_verify.mode.apply.help')
              : t('result_diff.view_verify.mode.dry_run.help')
          }
        />

        <div>
          <Typography.Text type="secondary">{t('result_diff.view_verify.mode')}</Typography.Text>
          <Select
            style={{ width: '100%', marginTop: 4 }}
            value={mode}
            disabled={running}
            options={[
              { value: 'apply', label: t('result_diff.view_verify.mode.apply') },
              { value: 'dry_run', label: t('result_diff.view_verify.mode.dry_run') },
            ]}
            onChange={(v) => setMode(v)}
          />
        </div>

        <div>
          <Typography.Text type="secondary">{t('result_diff.view_verify.where')}</Typography.Text>
          <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>
            {t('result_diff.view_verify.where.help')}
          </div>
          <Input.TextArea
            rows={2}
            value={whereClause}
            disabled={running}
            placeholder="billid = 1 AND ..."
            onChange={(e) => setWhereClause(e.target.value)}
          />
          <Typography.Paragraph
            type="secondary"
            style={{ fontSize: 12, marginTop: 6, marginBottom: 0 }}
            code
            copyable
          >
            {snapshotSql}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text type="secondary">{t('result_diff.wizard.key_columns')}</Typography.Text>
          <Select
            mode="multiple"
            style={{ width: '100%', marginTop: 4 }}
            loading={probing}
            disabled={running}
            value={keyColumns}
            options={columns.map((c) => ({ value: c, label: c }))}
            onChange={setKeyColumns}
            placeholder={
              probing
                ? t('result_diff.view_verify.probing_columns')
                : t('result_diff.wizard.key_columns')
            }
          />
        </div>

        <div>
          <Typography.Text type="secondary">{t('result_diff.view_verify.max_rows')}</Typography.Text>
          <InputNumber
            style={{ width: '100%', marginTop: 4 }}
            min={0}
            step={1000}
            value={maxRowsPerSide}
            disabled={running}
            onChange={(v) => setMaxRowsPerSide(Number(v) || 0)}
          />
          <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
            {t('result_diff.view_verify.max_rows.help')}
          </div>
        </div>

        <Space direction="vertical">
          <Checkbox
            checked={Boolean(options.trimStrings)}
            disabled={running}
            onChange={(e) => setOptions((p) => ({ ...p, trimStrings: e.target.checked }))}
          >
            {t('result_diff.wizard.options.trim')}
          </Checkbox>
          <Checkbox
            checked={Boolean(options.ignoreCase)}
            disabled={running}
            onChange={(e) => setOptions((p) => ({ ...p, ignoreCase: e.target.checked }))}
          >
            {t('result_diff.wizard.options.ignore_case')}
          </Checkbox>
          <Checkbox
            checked={Boolean(options.nullEqualsEmpty)}
            disabled={running}
            onChange={(e) => setOptions((p) => ({ ...p, nullEqualsEmpty: e.target.checked }))}
          >
            {t('result_diff.wizard.options.null_empty')}
          </Checkbox>
        </Space>

        {running && (
          <>
            <Steps
              size="small"
              current={step}
              items={[
                { title: t('result_diff.view_verify.step.prepare') },
                { title: t('result_diff.view_verify.step.left') },
                { title: mode === 'apply' ? t('result_diff.view_verify.step.ddl') : t('result_diff.view_verify.step.right') },
                { title: t('result_diff.view_verify.step.right') },
                { title: t('result_diff.view_verify.step.diff') },
              ]}
            />
            {statusText && (
              <Typography.Text type="secondary">{statusText}</Typography.Text>
            )}
          </>
        )}
      </Space>
    </Modal>
  );
};

export default ViewDataVerifyWizard;
