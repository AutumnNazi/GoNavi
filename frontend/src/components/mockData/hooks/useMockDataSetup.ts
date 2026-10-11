import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOptionalI18n } from '../../../i18n/provider';
import { getCurrentLanguage, t as defaultTranslate } from '../../../i18n';
import { useStore } from '../../../store';
import type { SavedConnection, TabData } from '../../../types';
import { inspectMockDataTable, type MockDataTarget } from '../mockDataApi';
import {
  createMockDataSeed,
  MOCK_DATA_DEFAULT_ROW_COUNT,
  resolveMockDataLocale,
  switchMockDataGeneratorKind,
  type MockDataColumnInfo,
  type MockDataColumnPlan,
  type MockDataGenerator,
  type MockDataInspection,
  type MockDataKind,
  type MockDataLocale,
  type MockDataPlan,
} from '../mockDataModel';

type LoadState = { status: 'idle' | 'loading' | 'ready' | 'error'; message?: string };

export type MockDataSetup = ReturnType<typeof useMockDataSetup>;

/**
 * 读取目标表结构与推荐规则，维护用户编辑中的生成计划。
 * 计划只活在组件里：模拟数据标签页不随重启恢复，避免旧表结构配上新计划。
 */
export const useMockDataSetup = ({ tab }: { tab: TabData }) => {
  const i18n = useOptionalI18n();
  const t = i18n?.t ?? defaultTranslate;
  const locale: MockDataLocale = resolveMockDataLocale(i18n?.language ?? getCurrentLanguage());
  const connection: SavedConnection | undefined = useStore((state) => state.connections.find((item) => item.id === tab.connectionId));
  const dbName = String(tab.dbName || '').trim();
  const tableName = String(tab.tableName || '').trim();
  const target = useMemo<MockDataTarget | null>(() => (
    connection && tableName ? { config: connection.config, dbName, tableName } : null
  ), [connection, dbName, tableName]);

  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [inspection, setInspection] = useState<MockDataInspection | null>(null);
  const [columns, setColumns] = useState<MockDataColumnPlan[]>([]);
  const [rowCount, setRowCount] = useState<number>(MOCK_DATA_DEFAULT_ROW_COUNT);
  const [seed, setSeed] = useState<number>(createMockDataSeed);
  const [continueOnError, setContinueOnError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const requestRef = useRef(0);

  useEffect(() => {
    if (!target) {
      setLoadState({ status: 'error', message: t('mock_data.workbench.target_missing') });
      return;
    }
    const requestId = ++requestRef.current;
    setLoadState({ status: 'loading' });
    inspectMockDataTable(target, locale)
      .then((result) => {
        if (requestId !== requestRef.current) return;
        if (!result.success || !result.data) {
          setLoadState({ status: 'error', message: result.message || t('mock_data.workbench.load_failed') });
          return;
        }
        setInspection(result.data);
        setColumns(result.data.plans.map((plan) => ({ ...plan, generator: { ...plan.generator } })));
        setLoadState({ status: 'ready' });
      })
      .catch((error: unknown) => {
        if (requestId !== requestRef.current) return;
        setLoadState({ status: 'error', message: error instanceof Error ? error.message : String(error) });
      });
    // locale 只影响推荐规则的语言，切换界面语言不重新读表。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, reloadToken]);

  const columnInfoByName = useMemo(() => {
    const map = new Map<string, MockDataColumnInfo>();
    inspection?.columns.forEach((column) => map.set(column.profile.name, column));
    return map;
  }, [inspection]);

  const suggestedByName = useMemo(() => {
    const map = new Map<string, MockDataGenerator>();
    inspection?.plans.forEach((plan) => map.set(plan.name, plan.generator));
    return map;
  }, [inspection]);

  const updateColumn = useCallback((name: string, patch: Partial<MockDataColumnPlan>) => {
    setColumns((current) => current.map((column) => (column.name === name ? { ...column, ...patch } : column)));
  }, []);

  const updateGenerator = useCallback((name: string, patch: Partial<MockDataGenerator>) => {
    setColumns((current) => current.map((column) => (
      column.name === name ? { ...column, generator: { ...column.generator, ...patch } } : column
    )));
  }, []);

  const changeKind = useCallback((name: string, kind: MockDataKind) => {
    const info = columnInfoByName.get(name);
    if (!info) return;
    updateColumn(name, { generator: switchMockDataGeneratorKind(kind, info.profile, locale, suggestedByName.get(name)) });
  }, [columnInfoByName, locale, suggestedByName, updateColumn]);

  const resetSuggestions = useCallback(() => {
    if (!inspection) return;
    setColumns(inspection.plans.map((plan) => ({ ...plan, generator: { ...plan.generator } })));
  }, [inspection]);

  const plan = useMemo<MockDataPlan>(() => ({ rowCount, seed, locale, columns }), [rowCount, seed, locale, columns]);

  return {
    t,
    connection,
    target,
    loadState,
    inspection,
    columns,
    columnInfoByName,
    rowCount,
    setRowCount,
    seed,
    setSeed,
    rerollSeed: () => setSeed(createMockDataSeed()),
    continueOnError,
    setContinueOnError,
    updateColumn,
    updateGenerator,
    changeKind,
    resetSuggestions,
    reload: () => setReloadToken((value) => value + 1),
    plan,
    maxRowCount: inspection?.maxRowCount ?? 1_000_000,
  };
};
