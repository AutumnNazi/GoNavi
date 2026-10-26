import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CACHED_MESSAGE_DETAILS } from './messageQueue/hooks/useMessageDetailLoader';

const backend = vi.hoisted(() => ({
  DBQuery: vi.fn(),
  consumeSubmission: null as any,
  error: vi.fn(),
  warning: vi.fn(),
}));
const storeState = vi.hoisted(() => ({
  connections: [{ id: 'kafka-1', name: 'Kafka test', config: { type: 'kafka', host: '127.0.0.1', port: 9092 } }] as any[],
}));

vi.mock('../../wailsjs/go/app/App', () => backend);
vi.mock('../store', () => ({ useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState) }));
vi.mock('../utils/messageWorkbenchPersistence', () => ({
  loadMessageSubscriptions: () => [],
  saveMessageSubscriptions: () => true,
}));
vi.mock('../i18n/provider', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@ant-design/icons', async () => {
  const ReactModule = await import('react');
  const icon = (name: string) => () => ReactModule.createElement('i', { 'data-icon': name });
  return Object.fromEntries(['ClearOutlined', 'CodeOutlined', 'DeleteOutlined', 'InboxOutlined', 'PauseCircleOutlined',
    'PlayCircleOutlined', 'PlusOutlined', 'ReloadOutlined', 'SendOutlined', 'CopyOutlined'].map((name) => [name, icon(name)]));
});
vi.mock('antd', async () => {
  const ReactModule = await import('react');
  const passthrough = (tag: string) => ({ children, ...props }: any) => ReactModule.createElement(tag, props, children);
  const Input = Object.assign(
    (props: any) => ReactModule.createElement('input', props),
    { Search: (props: any) => ReactModule.createElement('input', props) },
  );
  return {
    Badge: passthrough('span'), Empty: passthrough('div'), Segmented: passthrough('div'), Space: passthrough('div'),
    Tag: passthrough('span'), Typography: { Text: passthrough('span') }, Input,
    Skeleton: () => ReactModule.createElement('div', { 'data-testid': 'skeleton' }),
    Button: ({ children, icon, ...props }: any) => ReactModule.createElement(
      'button', props, ReactModule.createElement(ReactModule.Fragment, null, icon, children),
    ),
    Modal: ({ children, open, ...props }: any) => (open ? ReactModule.createElement('div', props, children) : null),
    Tooltip: ({ children }: any) => ReactModule.createElement(ReactModule.Fragment, null, children),
    message: { info: vi.fn(), success: vi.fn(), warning: backend.warning, error: backend.error },
  };
});
vi.mock('./MessageConsumeModal', () => ({
  default: (props: any) => (props.open
    ? <button data-testid="confirm-subscription" onClick={() => props.onConfirm(backend.consumeSubmission)}>confirm</button>
    : null),
}));
vi.mock('./MessageCommandModal', () => ({ default: () => null }));
vi.mock('./MessagePublishModal', () => ({ default: () => null }));

import MessageQueueWorkbench from './MessageQueueWorkbench';

type Deferred = { promise: Promise<any>; resolve: (value: any) => void };
const deferred = (): Deferred => {
  let resolve!: (value: any) => void;
  const promise = new Promise<any>((done) => { resolve = done; });
  return { promise, resolve };
};

const collectText = (node: any): string => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectText).join(' ');
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return collectText(node.props.children);
  return collectText(node.children);
};

const LIST_SQL = 'SELECT timestamp, partition, offset, key, value_size FROM "big" LATEST LIMIT 100;';
const detailOffset = (sql: string): number | null => {
  const match = /offset = (\d+) /.exec(sql);
  return match ? Number(match[1]) : null;
};
const detailCalls = (offset: number) => backend.DBQuery.mock.calls.filter(([, , sql]) => detailOffset(sql) === offset).length;

// LATEST 预览按时间倒序返回；工作台要把最新的放在最下面。
const listRows = (count: number) => Array.from({ length: count }, (_, index) => {
  const offset = count - 1 - index;
  return { timestamp: new Date(Date.UTC(2026, 9, 21, 10, 0, offset)).toISOString(), partition: 0, offset, key: `k${offset}`, value_size: 15_505_118 };
});

let renderer: ReactTestRenderer;
const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
const cards = () => renderer.root.findAllByType('article');
const cardOffsets = () => cards().map((card) => Number(/#(\d+)/.exec(collectText(card.props.children))?.[1]));
const clickCard = async (index: number) => {
  act(() => { cards()[index].props.onClick(); });
  await flush();
};

const openPreview = async (rowCount: number, listMessages: string[] = []) => {
  act(() => {
    renderer = create(<MessageQueueWorkbench isActive tab={{ id: 't', type: 'message-queue', connectionId: 'kafka-1', dbName: 'topics' } as any} />);
  });
  const add = renderer.root.findAllByType('button').find((button) => collectText(button.props.children).includes('message_consume.action.consume_preview'));
  act(() => { add!.props.onClick(); });
  backend.DBQuery.mockImplementationOnce(() => Promise.resolve({ success: true, data: listRows(rowCount), messages: listMessages }));
  act(() => { renderer.root.findByProps({ 'data-testid': 'confirm-subscription' }).props.onClick(); });
  await flush();
};

describe('MessageQueueWorkbench Kafka detail loading', () => {
  let pending: Map<number, Deferred[]>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout });
    backend.DBQuery.mockReset();
    backend.error.mockReset();
    backend.warning.mockReset();
    backend.consumeSubmission = {
      draft: { destination: 'big', limit: 100 },
      command: { commandText: LIST_SQL, destinationLabel: 'big', mode: 'pull-preview' },
    };
    pending = new Map();
    backend.DBQuery.mockImplementation((_config: any, _db: string, sql: string) => {
      const offset = detailOffset(sql);
      const request = deferred();
      if (offset !== null) pending.set(offset, [...(pending.get(offset) || []), request]);
      return request.promise;
    });
  });

  afterEach(async () => {
    await act(async () => {
      pending.forEach((requests) => requests.forEach((request) => request.resolve({ success: true, data: [] })));
      await Promise.resolve();
    });
    act(() => { renderer?.unmount(); });
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows LATEST results oldest first and surfaces backend notices', async () => {
    await openPreview(3, ['preview truncated notice']);
    expect(cardOffsets()).toEqual([0, 1, 2]);
    expect(backend.warning).toHaveBeenCalledWith('preview truncated notice');
    // 跟随最新：自动选中最下面那条（offset 2）并加载一次。
    expect(detailCalls(2)).toBe(1);
  });

  it('issues one detail query per click', async () => {
    await openPreview(3);
    await clickCard(0);
    expect(detailCalls(0)).toBe(1);
    await clickCard(0);
    expect(detailCalls(0)).toBe(1);
  });

  it('keeps the skeleton while the selected message is still loading', async () => {
    await openPreview(3);
    await clickCard(0);
    await clickCard(1);
    expect(renderer.root.findAllByProps({ 'data-testid': 'skeleton' })).toHaveLength(1);
    await act(async () => {
      pending.get(0)?.forEach((request) => request.resolve({ success: true, data: [{ partition: 0, offset: 0, value: { a: 1 } }] }));
      await Promise.resolve();
    });
    expect(renderer.root.findAllByProps({ 'data-testid': 'skeleton' })).toHaveLength(1);
  });

  it('distinguishes a missing message from a failed load and skips stale toasts', async () => {
    await openPreview(3);
    await clickCard(0);
    await act(async () => {
      pending.get(0)?.forEach((request) => request.resolve({ success: true, data: [] }));
      await Promise.resolve();
    });
    expect(backend.error).toHaveBeenLastCalledWith('message_queue_workbench.message.not_found');

    await clickCard(1);
    await act(async () => {
      pending.get(1)?.forEach((request) => request.resolve({ success: false, message: 'broker unreachable' }));
      await Promise.resolve();
    });
    expect(backend.error).toHaveBeenLastCalledWith('broker unreachable');

    backend.error.mockReset();
    await clickCard(2);
    await clickCard(0);
    await act(async () => {
      pending.get(2)?.forEach((request) => request.resolve({ success: false, message: 'stale failure' }));
      await Promise.resolve();
    });
    expect(backend.error).not.toHaveBeenCalledWith('stale failure');
  });

  it('bounds the payload cache and reloads evicted messages on click', async () => {
    const total = MAX_CACHED_MESSAGE_DETAILS + 2;
    backend.DBQuery.mockImplementation((_config: any, _db: string, sql: string) => {
      const offset = detailOffset(sql);
      return Promise.resolve({ success: true, data: [{ partition: 0, offset, value: { offset } }] });
    });
    await openPreview(total);
    for (let index = 0; index < total; index += 1) {
      await clickCard(index);
    }
    // 最早缓存的消息已被淘汰：再次点击会重新加载；刚加载过的仍命中缓存。
    expect(detailCalls(0)).toBe(1);
    await clickCard(0);
    expect(detailCalls(0)).toBe(2);
    await clickCard(total - 2);
    expect(detailCalls(total - 2)).toBe(1);
  });
});
