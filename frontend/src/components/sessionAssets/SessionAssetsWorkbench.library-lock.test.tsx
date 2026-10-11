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
const storeState = vi.hoisted(() => ({
  agentIntegrations: [] as Array<Record<string, unknown>>,
  refreshAgentIntegrations: vi.fn(async () => {}),
}));
vi.mock('../../store', () => ({
  useStore: (selector: (state: typeof storeState) => any) => selector(storeState),
}));
import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { SessionAssetsWorkbench } from './SessionAssetsWorkbench';
import type { SessionAssetsApi } from './sessionAssetsApi';

// 材料库被其他实例占用（libraryLocked）时，工作台仍可进入并展示降级
// 提示，而不是空白或报错（用户反馈：重启后集成"消失"）。

const buildApi = (): SessionAssetsApi => ({
  listAssets: vi.fn(async () => ({ items: [], total: 0 })),
  getAssetDetail: vi.fn(async () => null),
  readHistory: vi.fn(async () => ({ entries: [], nextOffset: 0, hasMore: false, readSource: 'missing' as const })),
  exportAsset: vi.fn(async () => ({ file: '' })),
  deleteAsset: vi.fn(async () => true),
  refreshSources: vi.fn(async () => true),
  continueSession: vi.fn(async () => ({ stage: 'entry_launched' })),
  launchInteractive: vi.fn(async () => ({ stage: 'entry_launched' })),
  prepareHandoff: vi.fn(async () => ({ stage: 'materials_ready', noteFile: '' })),
  previewHandoff: vi.fn(async () => ({ mode: 'recent' as const, resolvedFrom: 0, resolvedTo: 0 })),
  getCapability: vi.fn(async () => ({ nativeResume: false, newSession: false, manualMaterial: true })),
  retryCapture: vi.fn(async () => true),
});

const renderWithIntegration = async (locked: boolean) => {
  storeState.agentIntegrations = [{
    integrationId: 'test',
    kind: 'codex',
    displayName: 'Codex',
    enabled: true,
    assetCount: 3,
    ...(locked ? { libraryLocked: true } : {}),
  }];
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SessionAssetsWorkbench
        tab={{ id: 'agent-assets:test', title: 'Codex · 会话资产', type: 'agent-assets', connectionId: '', agentIntegrationId: 'test' }}
        api={buildApi()}
      />,
    );
  });
  await act(async () => {});
  return tree!;
};

describe('SessionAssetsWorkbench library lock', () => {
  it('shows the degraded banner when the library is held by another instance', async () => {
    const tree = await renderWithIntegration(true);
    expect(tree.root.findByProps({ 'data-testid': 'alert' })).toBeTruthy();
    expect(tree.root.findByProps({ 'data-session-assets-list': 'true' })).toBeTruthy();
  });

  it('shows no banner while the library is available', async () => {
    const tree = await renderWithIntegration(false);
    expect(() => tree.root.findByProps({ 'data-testid': 'alert' })).toThrow();
  });
});
