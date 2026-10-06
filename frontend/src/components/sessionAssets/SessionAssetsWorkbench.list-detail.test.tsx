// @vitest-environment jsdom
import React from 'react';

vi.mock('antd', () => {
  const Light = (tag: string) => (props: any) =>
    React.createElement(tag, { ...props, title: undefined, 'aria-label': props['aria-label'] }, props.children);
  const Button = (props: any) =>
    React.createElement('button', { ...props, loading: undefined, block: undefined, size: undefined, danger: undefined, icon: undefined }, props.children);
  return {
    Button,
    Input: (props: any) => React.createElement('input', { value: props.value, onChange: props.onChange, placeholder: props.placeholder }),
    Select: (props: any) => React.createElement('select', { value: props.value, onChange: props.onChange }),
    Tooltip: (props: any) => React.createElement('span', null, props.children),
    Spin: Light('span'),
    Empty: Object.assign(Light('span'), { PRESENTED_IMAGE_SIMPLE: null }),
    Alert: (props: any) => React.createElement('div', { 'data-testid': 'alert' }, props.message, props.description),
    Tabs: (props: any) => React.createElement('div', null, (props.items || []).map((item: any) => React.createElement('div', { key: item.key }, item.children))),
    Tag: Light('span'),
    Modal: Object.assign(Light('span'), { confirm: vi.fn() }),
    message: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  };
});
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { SessionAssetsWorkbench } from './SessionAssetsWorkbench';
import type { SessionAssetsApi } from './sessionAssetsApi';

// M4 工作台的虚构数据路径：列表渲染、读源带、删除确认范围（V-07/V-20
// 的 UI 面）。不连接真实 Wails 绑定。

const buildAsset = (overrides: Record<string, unknown> = {}) => ({
  id: 'asset-1',
  nativeThreadId: 'thread-1',
  title: 'migration refactor',
  projectDir: 'C:/work/demo',
  provider: 'openai',
  model: 'gpt-5',
  updatedAt: 1760000000,
  sourceStatus: 'deleted',
  backupStatus: 'verified',
  materialStatus: 'readable',
  latestGenerationId: 'gen-1',
  latestComplete: true,
  lastBackupAt: 1760000100,
  hasBackup: true,
  ...overrides,
});

const buildDetail = (overrides: Record<string, unknown> = {}) => ({
  ...buildAsset(),
  readSource: 'backup' as const,
  readPath: 'X:/library/raw/rollout.jsonl',
  coverageAt: 1760000100,
  sourceRefs: [{ sourceId: 's1', nativePath: 'X:/archived/rollout.jsonl', sourceStatus: 'deleted' }],
  materialFiles: [{ relPath: 'raw/rollout.jsonl', size: 128, sha256: 'abc', role: 'primary' }],
  ancestors: [],
  attachments: [],
  missing: [],
  recentJobs: [],
  ...overrides,
});

const buildApi = (overrides: Partial<SessionAssetsApi> = {}): SessionAssetsApi => ({
  listAssets: vi.fn(async () => ({ items: [buildAsset()], total: 1 })),
  getAssetDetail: vi.fn(async () => buildDetail()),
  readHistory: vi.fn(async () => ({
    entries: [
      { index: 0, kind: 'system', text: '' },
      { index: 1, kind: 'message', role: 'user', text: 'hello' },
      { index: 2, kind: 'tool_call', name: 'shell', callId: 'c1', text: '{}', opaque: false },
    ],
    nextOffset: 3,
    hasMore: false,
    readSource: 'backup',
  })),
  exportAsset: vi.fn(async () => ({ file: 'X:/export/out.zip' })),
  deleteAsset: vi.fn(async () => true),
  refreshSources: vi.fn(async () => true),
  continueSession: vi.fn(async () => ({ stage: 'entry_launched' })),
  launchInteractive: vi.fn(async () => ({ stage: 'entry_launched' })),
  prepareHandoff: vi.fn(async () => ({ stage: 'materials_ready', noteFile: 'X:/handoff/notes.md' })),
  previewHandoff: vi.fn(async () => ({ mode: 'recent', resolvedFrom: 0, resolvedTo: 2 })),
  getCapability: vi.fn(async () => ({ nativeResume: true, newSession: true, manualMaterial: true })),
  retryCapture: vi.fn(async () => true),
  ...overrides,
});

const renderWorkbench = async (api: SessionAssetsApi) => {
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SessionAssetsWorkbench
        tab={{ id: 'agent-assets:test', title: 'Codex · 会话资产', type: 'agent-assets', connectionId: '', agentIntegrationId: 'test' }}
        api={api}
      />,
    );
  });
  // 冲刷列表/详情的异步加载。
  await act(async () => {});
  return tree!;
};

describe('SessionAssetsWorkbench', () => {
  it('renders the list with independent source and backup states', async () => {
    const api = buildApi();
    const tree = await renderWorkbench(api);
    const root = tree.root;
    expect(root.findByProps({ 'data-session-assets-list': 'true' })).toBeTruthy();
    expect(root.findByProps({ 'data-source-state': 'deleted' })).toBeTruthy();
    expect(root.findByProps({ 'data-backup-state': 'verified' })).toBeTruthy();
  });

  it('selects an asset and shows the backup read-source band with coverage', async () => {
    const api = buildApi();
    const tree = await renderWorkbench(api);
    await act(async () => {
      tree.root.findByProps({ 'data-session-assets-list': 'true' }).props.children;
    });
    // 通过列表行按钮触发选择。
    const row = tree.root.find((node) => node.props.className?.includes?.('session-assets-row'));
    await act(async () => {
      row.props.onClick();
    });
    await act(async () => {});
    const detail = tree.root.findByProps({ 'data-session-assets-detail': 'true' });
    expect(detail).toBeTruthy();
    expect(api.getAssetDetail).toHaveBeenCalledWith('asset-1');
    expect(api.readHistory).toHaveBeenCalledWith('asset-1', 0, 100);
  });

  it('loads more history pages through the cursor', async () => {
    const api = buildApi({ readHistory: vi.fn()
      .mockResolvedValueOnce({
        entries: [{ index: 0, kind: 'message', role: 'user', text: 'page1' }],
        nextOffset: 1, hasMore: true, readSource: 'backup',
      })
      .mockResolvedValueOnce({
        entries: [{ index: 1, kind: 'message', role: 'assistant', text: 'page2' }],
        nextOffset: 2, hasMore: false, readSource: 'backup',
      }) });
    const tree = await renderWorkbench(api);
    const row = tree.root.find((node) => node.props.className?.includes?.('session-assets-row'));
    await act(async () => {
      row.props.onClick();
    });
    {
      const all = (tree as any).root.findAll((n: any) => n && n.props);
      const buttons = all.filter((n: any) => n.type === 'button');
    }
    await act(async () => {
      const loadMore = tree.root.find((node) => node.props['data-history-load-more'] === 'true');
      loadMore.props.onClick();
    });
    const all = (tree as any).root.findAll((n: any) => n && n.props);
    const detailNodes = all.filter((n: any) => n.props['data-session-assets-detail']);
    expect(api.readHistory).toHaveBeenCalledTimes(2);
    expect(api.readHistory).toHaveBeenLastCalledWith('asset-1', 1, 100);
  });
});
