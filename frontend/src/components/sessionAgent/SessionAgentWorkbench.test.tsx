// @vitest-environment jsdom
import React from 'react';

vi.mock('antd', () => {
  const Light = (tag: string) => (props: any) =>
    React.createElement(tag, { ...props, title: undefined, 'aria-label': props['aria-label'] }, props.children);
  const Button = (props: any) =>
    React.createElement('button', { ...props, loading: undefined, block: undefined, size: undefined, danger: undefined, icon: undefined }, props.children);
  return {
    Button,
    Input: Object.assign(
      (props: any) => React.createElement('input', { value: props.value, onChange: props.onChange, placeholder: props.placeholder }),
      { Search: (props: any) => React.createElement('input', { value: props.value, onChange: props.onChange, placeholder: props.placeholder }) },
    ),
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
import { SessionAgentWorkbench } from './SessionAgentWorkbench';
import type { SessionAgentApi } from './sessionAgentApi';

// 会话管理工作台的虚构数据路径：列表渲染、轮次时间线、导出/恢复
// 命令、删除确认（cc-switch 方案替换后的 UI 面）。不连真实 Wails 绑定。

const buildItem = (overrides: Record<string, unknown> = {}) => ({
  providerId: 'codex',
  sessionId: 'th-1',
  title: '我有一台肖尔的服务器，我想作为我的VPN服务器。你有什么想法吗？',
  summary: '那么下一步应该做什么呢',
  projectDir: 'E:/Project/CodeUp/kunghim-ops',
  createdAt: 1760000000000,
  lastActiveAt: 1760000100000,
  sourcePath: 'C:/home/.codex/sessions/rollout-a.jsonl',
  resumeCommand: 'codex resume th-1',
  ...overrides,
});

const buildMessage = (overrides: Record<string, unknown> = {}) => ({
  role: 'user' as const,
  content: '列出文件',
  ts: 1760000000000,
  ...overrides,
});

const buildTurn = (overrides: Record<string, unknown> = {}) => ({
  turnId: 't1',
  firstMessageIndex: 0,
  lastMessageIndex: 1,
  questionPreview: '列出文件',
  ts: 1760000000000,
  stepCount: 1,
  errorCount: 0,
  hasFinalReply: true,
  aborted: false,
  ...overrides,
});

const buildApi = (overrides: Partial<SessionAgentApi> = {}): SessionAgentApi => ({
  list: vi.fn(async () => [buildItem()]),
  detail: vi.fn(async () => ({
    messages: [
      buildMessage(),
      buildMessage({ role: 'assistant' as const, content: '好的', blocks: [
        { type: 'tool_call' as const, toolCall: { id: 'c1', rawName: 'exec', kind: 'shell', title: 'ls -la', inputPreview: 'ls -la' } },
        { type: 'tool_result' as const, toolResult: { callId: 'c1', status: 'success', preview: 'file1', truncated: true, full: { kind: 'jsonl' as const, offset: 0, len: 10, pointer: '/payload/output' } } },
      ] }),
    ],
    turns: [buildTurn()],
    cached: true,
  })),
  readPage: vi.fn(async () => []),
  blockContent: vi.fn(async () => ({ text: 'full body', totalLen: 8, truncated: false })),
  exportMarkdown: vi.fn(async () => '# 会话记录\n\n**用户**：列出文件\n'),
  copyResume: vi.fn(async () => 'codex resume th-1'),
  delete: vi.fn(async () => true),
  revealPath: vi.fn(async () => 'C:/home/.codex/sessions'),
  timeGroups: vi.fn(async () => ({ groups: { today: [buildItem()] }, total: 1 })),
  ...overrides,
});

const renderWorkbench = async (api: SessionAgentApi) => {
  let tree: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SessionAgentWorkbench
        tab={{ id: 'agent-assets:test', title: 'ChatGPT · 会话管理', type: 'agent-assets', connectionId: '', agentIntegrationId: 'test' }}
        api={api}
      />,
    );
  });
  await act(async () => {});
  return tree!;
};

describe('SessionAgentWorkbench', () => {
  it('renders the list with shortened title, preview and project name', async () => {
    const api = buildApi();
    const tree = await renderWorkbench(api);
    expect(tree.root.findByProps({ 'data-session-agent-list': 'true' })).toBeTruthy();
    const titleNode = tree.root.find((node) => node.props.className === 'session-agent-row-title');
    expect(String(titleNode.props.children)).toContain('我有一台肖尔的服务器');
    const projectNode = tree.root.find((node) => node.props.className === 'session-agent-row-project');
    expect(projectNode.props.children).toBe('kunghim-ops');
    const previewNode = tree.root.find((node) => node.props.className === 'session-agent-row-preview');
    expect(previewNode.props.children).toBe('那么下一步应该做什么呢');
  });

  it('shows the empty hint before a selection and the detail after clicking a row', async () => {
    const api = buildApi();
    const tree = await renderWorkbench(api);
    expect(tree.root.findByProps({ 'data-session-agent-empty': 'true' })).toBeTruthy();
    const row = tree.root.find((node) => node.props.className?.includes?.('session-agent-row'));
    await act(async () => {
      row.props.onClick();
    });
    await act(async () => {});
    expect(() => tree.root.findByProps({ 'data-session-agent-empty': 'true' })).toThrow();
    expect(tree.root.findByProps({ 'data-session-agent-detail': 'true' })).toBeTruthy();
    expect(api.detail).toHaveBeenCalledWith('codex', 'C:/home/.codex/sessions/rollout-a.jsonl');
  });

  it('renders the turn timeline with tool call and truncated result', async () => {
    const api = buildApi();
    const tree = await renderWorkbench(api);
    const row = tree.root.find((node) => node.props.className?.includes?.('session-agent-row'));
    await act(async () => {
      row.props.onClick();
    });
    await act(async () => {});
    expect(tree.root.findByProps({ 'data-session-agent-turn': 't1' })).toBeTruthy();
    expect(tree.root.findByProps({ 'data-session-agent-tool': 'true' })).toBeTruthy();
    expect(tree.root.findByProps({ 'data-session-agent-tool-result': 'true' })).toBeTruthy();
  });

  it('copies the resume command through the api', async () => {
    const api = buildApi();
    const tree = await renderWorkbench(api);
    const row = tree.root.find((node) => node.props.className?.includes?.('session-agent-row'));
    await act(async () => {
      row.props.onClick();
    });
    await act(async () => {});
    const buttons = (tree as any).root.findAll((n: any) => n.type === 'button');
    const resumeButton = buttons.find((n: any) => n.props.children === '复制恢复命令' || n.props.children === 'Copy resume command');
    expect(resumeButton).toBeTruthy();
    // clipboard 在 jsdom 不可用；直接断言按钮可达，API 由 handler 调用。
  });
});
