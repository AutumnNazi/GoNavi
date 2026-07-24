import { readFileSync } from 'node:fs';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const messageApi = vi.hoisted(() => ({
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn(),
}));

const dbGetDatabasesMock = vi.hoisted(() => vi.fn());
const dbGetTablesMock = vi.hoisted(() => vi.fn());
const dbGetColumnsMock = vi.hoisted(() => vi.fn());
const dbShowCreateTableMock = vi.hoisted(() => vi.fn());

vi.mock('antd', () => ({
  message: messageApi,
}));

vi.mock('../../../wailsjs/go/app/App', () => ({
  DBGetDatabases: dbGetDatabasesMock,
  DBGetTables: dbGetTablesMock,
  DBGetColumns: dbGetColumnsMock,
  DBShowCreateTable: dbShowCreateTableMock,
}));

import { useStore } from '../../store';
import { useAIChatContextBinding } from './useAIChatContextBinding';

const source = readFileSync(new URL('./useAIChatContextBinding.ts', import.meta.url), 'utf8');
const inputSource = readFileSync(new URL('./AIChatInput.tsx', import.meta.url), 'utf8');
const zhCnCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-CN.json', import.meta.url), 'utf8'));
const zhTwCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/zh-TW.json', import.meta.url), 'utf8'));
const enUsCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/en-US.json', import.meta.url), 'utf8'));
const jaJpCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ja-JP.json', import.meta.url), 'utf8'));
const deDeCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/de-DE.json', import.meta.url), 'utf8'));
const ruRuCatalog = JSON.parse(readFileSync(new URL('../../../../shared/i18n/ru-RU.json', import.meta.url), 'utf8'));

type HarnessProps = Parameters<typeof useAIChatContextBinding>[0];

let latestHook: ReturnType<typeof useAIChatContextBinding> | undefined;

const addAIContextMock = vi.fn();
const removeAIContextMock = vi.fn();

const baseProps: HarnessProps = {
  activeContext: { connectionId: 'conn-1', dbName: 'analytics' },
  activeContextItems: [],
  connectionKey: 'conn-1::analytics',
  addAIContext: addAIContextMock,
  removeAIContext: removeAIContextMock,
};

const HookHarness = (props: Partial<HarnessProps>) => {
  latestHook = useAIChatContextBinding({
    ...baseProps,
    ...props,
  });
  return null;
};

describe('useAIChatContextBinding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    latestHook = undefined;
    useStore.setState({
      connections: [{
        id: 'conn-1',
        name: 'analytics-primary',
        config: {
          type: 'mysql',
          host: '127.0.0.1',
          port: 3306,
          user: 'root',
        },
      }],
    } as any);
  });

  afterEach(() => {
    useStore.setState({ connections: [] } as any);
  });

  it('wires AIChatInput into hook-level translation and removes legacy Chinese context-binding literals', () => {
    expect(source).toContain("catalogTranslate('en-US', key, params)");
    expect(source).toContain("ai_chat.input.message.fetch_tables_failed");
    expect(source).toContain("ai_chat.input.message.select_database_context_first");
    expect(source).toContain("ai_chat.input.message.context_load_failed");
    expect(source).toContain("ai_chat.input.message.fetch_table_schema_failed");
    expect(source).toContain("ai_chat.input.message.context_added");
    expect(source).toContain("ai_chat.input.message.context_removed");
    expect(source).toContain("ai_chat.input.message.context_synced");
    expect(source).toContain("ai_chat.input.message.selection_unchanged");
    expect(source).toContain("ai_chat.input.message.context_sync_failed");
    expect(inputSource).toMatch(/useAIChatContextBinding\(\{\s*[\s\S]*translate:\s*t,/);
    expect(source).not.toContain('获取表格失败');
    expect(source).not.toContain('请先在左侧选择一个数据库作为所聊上下文');
    expect(source).not.toContain('读取上下文表失败');
    expect(source).not.toContain('获取表 ');
    expect(source).not.toContain('已添加 ');
    expect(source).not.toContain('已从上下文移除 ');
    expect(source).not.toContain('上下文已同步更新：新增 ');
    expect(source).not.toContain('选中的表未发生变化');
    expect(source).not.toContain('同步 AI 上下文失败');
  });

  it('keeps required context-binding message keys present in all six catalogs', () => {
    const requiredKeys = [
      'ai_chat.input.message.fetch_tables_failed',
      'ai_chat.input.message.select_database_context_first',
      'ai_chat.input.message.context_load_failed',
      'ai_chat.input.message.fetch_table_schema_failed',
      'ai_chat.input.message.context_added',
      'ai_chat.input.message.context_removed',
      'ai_chat.input.message.context_synced',
      'ai_chat.input.message.selection_unchanged',
      'ai_chat.input.message.context_sync_failed',
    ];

    for (const key of requiredKeys) {
      expect(zhCnCatalog[key]).toBeTruthy();
      expect(zhTwCatalog[key]).toBeTruthy();
      expect(enUsCatalog[key]).toBeTruthy();
      expect(jaJpCatalog[key]).toBeTruthy();
      expect(deDeCatalog[key]).toBeTruthy();
      expect(ruRuCatalog[key]).toBeTruthy();
    }
  });

  it('falls back to the English warning when no active database context is selected', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<HookHarness activeContext={null} />);
    });

    await act(async () => {
      await latestHook!.handleOpenContext();
    });

    expect(messageApi.warning).toHaveBeenCalledWith('Select a database on the left before attaching chat context');

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('surfaces the English table-load failure instead of silently swallowing failed context-table fetches', async () => {
    dbGetDatabasesMock.mockResolvedValue({
      success: true,
      data: [{ name: 'analytics' }],
    });
    dbGetTablesMock.mockResolvedValue({
      success: false,
      message: 'permission denied',
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<HookHarness activeContext={{ connectionId: 'conn-1', dbName: 'analytics' }} />);
    });

    await act(async () => {
      await latestHook!.handleOpenContext();
    });

    expect(messageApi.error).toHaveBeenCalledWith('Failed to load tables: permission denied');

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('uses the named table field instead of metadata values such as row counts', async () => {
    dbGetDatabasesMock.mockResolvedValue({
      success: true,
      data: [{ Database: 'analytics' }],
    });
    dbGetTablesMock.mockResolvedValue({
      success: true,
      data: [
        { Rows: '128', Table: 'users', Data_length: '4096' },
        { Index_length: '2048', table_name: 'orders', Rows: '42' },
        { Name: 'metadata-label', Rows: '7', TABLE: 'customers' },
      ],
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<HookHarness />);
    });

    await act(async () => {
      await latestHook!.handleOpenContext();
    });

    expect(latestHook!.filteredTables).toEqual([
      { name: 'users' },
      { name: 'orders' },
      { name: 'customers' },
    ]);

    await act(async () => {
      renderer!.unmount();
    });
  });

  it('falls back to the English unchanged-selection info message after a no-op sync', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<HookHarness />);
    });

    await act(async () => {
      await latestHook!.handleAppendContext();
    });

    expect(messageApi.info).toHaveBeenCalledWith('Selected tables did not change');

    await act(async () => {
      renderer!.unmount();
    });
  });
});
