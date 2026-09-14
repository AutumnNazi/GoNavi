import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BatchConnectionWorkbench from './BatchConnectionWorkbench';
import { setCurrentLanguage } from '../i18n';
import Modal from './common/ResizableDraggableModal';

const mockRemoveConnection = vi.fn();
const mockCloseTabsByConnection = vi.fn();

const createMockStoreState = () => ({
  connections: [
    {
      id: 'conn-1',
      name: 'Local',
      config: { type: 'mysql', host: 'localhost', port: 3306 },
    },
    {
      id: 'conn-2',
      name: 'Prod',
      config: { type: 'postgres', host: 'db.example.com', port: 5432 },
    },
    {
      id: 'conn-3',
      name: 'Cache',
      config: { type: 'redis', host: '127.0.0.1', port: 6379 },
    },
  ],
  connectionTags: [] as Array<{ id: string; name: string; connectionIds: string[]; parentTagId?: string }>,
  sidebarRootOrder: [] as string[],
  rootSortMode: 'manual' as const,
  rootConnectionSortMode: 'name' as const,
  removeConnection: mockRemoveConnection,
  closeTabsByConnection: mockCloseTabsByConnection,
});

let mockStoreState = createMockStoreState();
const deleteConnections = vi.fn().mockResolvedValue(undefined);

vi.mock('antd', async () => {
  const { createElement } = await import('react');
  const component = (tag: string) => ({ children, ...props }: any) => createElement(tag, props, children);
  const TreeSelect = Object.assign(component('mock-tree-select'), {
    SHOW_CHILD: 'SHOW_CHILD',
    SHOW_PARENT: 'SHOW_PARENT',
    SHOW_ALL: 'SHOW_ALL',
  });
  return {
    Alert: component('mock-alert'),
    Button: component('mock-button'),
    Input: component('mock-input'),
    Select: component('mock-select'),
    Tooltip: component('mock-tooltip'),
    Tree: component('mock-tree'),
    TreeSelect,
    message: {
      loading: vi.fn(() => vi.fn()),
      success: vi.fn(),
      error: vi.fn(),
    },
    Typography: {
      Text: component('mock-text'),
      Title: component('mock-title'),
    },
  };
});

vi.mock('./common/ResizableDraggableModal', () => ({
  default: { confirm: vi.fn() },
}));

vi.mock('@ant-design/icons', async () => {
  const { createElement } = await import('react');
  return {
    DeleteOutlined: () => createElement('mock-icon'),
    FolderOutlined: () => createElement('mock-folder-icon'),
  };
});

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  return {
    ...actual,
    useStore: (selector: (state: any) => any) => selector(mockStoreState),
  };
});

const flushAsyncWork = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const flattenTreeKeys = (nodes: Array<{ key: React.Key; children?: any[] }> | undefined): string[] => {
  const keys: string[] = [];
  const walk = (items: Array<{ key: React.Key; children?: any[] }> | undefined) => {
    (items || []).forEach((item) => {
      keys.push(String(item.key));
      walk(item.children);
    });
  };
  walk(nodes);
  return keys;
};

const findConnectionTree = (renderer: ReactTestRenderer) => (
  renderer.root.findByProps({ 'data-batch-connection-tree': 'true' })
);

const renderWorkbench = async (initialConnectionIds?: string[]) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      <BatchConnectionWorkbench
        tab={{
          id: 'table-export-batch-connections',
          title: '批量处理连接',
          type: 'table-export',
          exportWorkbenchMode: 'batch-connections',
          tableExportInitialConnectionIds: initialConnectionIds,
        }}
      />,
    );
    await flushAsyncWork();
  });
  return renderer;
};

describe('BatchConnectionWorkbench', () => {
  beforeEach(() => {
    setCurrentLanguage('zh-CN');
    mockRemoveConnection.mockReset();
    mockCloseTabsByConnection.mockReset();
    mockRemoveConnection.mockImplementation((id: string) => {
      mockStoreState = {
        ...mockStoreState,
        connections: mockStoreState.connections.filter((connection) => connection.id !== id),
      };
    });
    vi.mocked(Modal.confirm).mockReset();
    mockStoreState = createMockStoreState();
    deleteConnections.mockReset();
    deleteConnections.mockResolvedValue(undefined);
    vi.stubGlobal('window', {
      go: {
        app: {
          App: {
            DeleteConnections: deleteConnections,
          },
        },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a grouped connection TreeSelect matching the data-sync picker', async () => {
    const renderer = await renderWorkbench();
    const treeSelect = findConnectionTree(renderer);
    const deleteButton = renderer.root.findByProps({ 'data-batch-delete-connections': 'true' });

    expect(renderer.root.findByProps({ 'data-batch-connection-workbench': 'true' })).toBeTruthy();
    expect(treeSelect.props.multiple).toBe(true);
    expect(treeSelect.props.treeCheckable).toBe(true);
    expect(treeSelect.props.showSearch).toBe(true);
    expect(treeSelect.props.treeNodeFilterProp).toBe('searchText');
    expect(flattenTreeKeys(treeSelect.props.treeData)).toEqual([
      'connection:conn-3',
      'connection:conn-1',
      'connection:conn-2',
    ]);
    expect(deleteButton.props.disabled).toBe(true);

    renderer.unmount();
  });

  it('selects every host in a group when that group value is checked', async () => {
    mockStoreState = {
      ...createMockStoreState(),
      connectionTags: [{ id: 'dev', name: '开发', connectionIds: ['conn-1', 'conn-2'] }],
    };
    const renderer = await renderWorkbench();
    const treeSelect = findConnectionTree(renderer);

    expect(treeSelect.props.treeExpandedKeys).toEqual([]);
    expect(treeSelect.props.treeData[0].title.props.children.props['data-batch-connection-hover-trigger']).toBe('group');
    expect(treeSelect.props.treeData[0].children[0].title.props.title.props.title).toBe('Local');
    expect(flattenTreeKeys(treeSelect.props.treeData)).toEqual([
      'group:dev',
      'connection:conn-1',
      'connection:conn-2',
      'connection:conn-3',
    ]);

    await act(async () => {
      treeSelect.props.onChange(['group:dev']);
      await flushAsyncWork();
    });

    expect(findConnectionTree(renderer).props.value).toEqual([
      'connection:conn-1',
      'connection:conn-2',
    ]);
    expect(renderer.root.findByProps({ 'data-batch-delete-connections': 'true' }).props.disabled).toBe(false);

    renderer.unmount();
  });

  it('deletes selected connections atomically and drops only those hosts from local state', async () => {
    vi.mocked(Modal.confirm).mockImplementation((options: any) => {
      options.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });

    const renderer = await renderWorkbench(['conn-1', 'conn-2']);
    const deleteButton = renderer.root.findByProps({ 'data-batch-delete-connections': 'true' });
    expect(deleteButton.props.disabled).toBe(false);

    await act(async () => {
      deleteButton.props.onClick();
      await flushAsyncWork();
    });

    expect(deleteConnections).toHaveBeenCalledWith(['conn-1', 'conn-2']);
    expect(mockCloseTabsByConnection).toHaveBeenCalledWith('conn-1');
    expect(mockCloseTabsByConnection).toHaveBeenCalledWith('conn-2');
    expect(mockRemoveConnection).toHaveBeenCalledWith('conn-1');
    expect(mockRemoveConnection).toHaveBeenCalledWith('conn-2');
    expect(mockRemoveConnection).not.toHaveBeenCalledWith('conn-3');
    expect(findConnectionTree(renderer).props.value).toEqual([]);

    renderer.unmount();
  });

  it('keeps the current selection when backend deletion fails', async () => {
    vi.mocked(Modal.confirm).mockImplementation((options: any) => {
      options.onOk?.();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });
    deleteConnections.mockRejectedValue(new Error('locked'));

    const renderer = await renderWorkbench(['conn-1', 'conn-3']);
    const deleteButton = renderer.root.findByProps({ 'data-batch-delete-connections': 'true' });

    await act(async () => {
      deleteButton.props.onClick();
      await flushAsyncWork();
    });

    expect(mockRemoveConnection).not.toHaveBeenCalled();
    expect(mockCloseTabsByConnection).not.toHaveBeenCalled();
    expect(findConnectionTree(renderer).props.value).toEqual([
      'connection:conn-1',
      'connection:conn-3',
    ]);
    expect(renderer.root.findByProps({ 'data-batch-connection-status': 'error' })).toBeTruthy();

    renderer.unmount();
  });

  it('does not call the backend when the confirm dialog is cancelled', async () => {
    vi.mocked(Modal.confirm).mockImplementation((options: any) => {
      options.onCancel?.();
      return { destroy: vi.fn(), update: vi.fn() } as any;
    });

    const renderer = await renderWorkbench(['conn-1']);
    const deleteButton = renderer.root.findByProps({ 'data-batch-delete-connections': 'true' });

    await act(async () => {
      deleteButton.props.onClick();
      await flushAsyncWork();
    });

    expect(deleteConnections).not.toHaveBeenCalled();
    expect(mockRemoveConnection).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('shows an empty-state alert when no saved connections remain', async () => {
    mockStoreState = {
      ...createMockStoreState(),
      connections: [],
    };
    const renderer = await renderWorkbench();

    expect(renderer.root.findByProps({ 'data-batch-connections-empty': 'true' })).toBeTruthy();
    expect(renderer.root.findByProps({ 'data-batch-delete-connections': 'true' }).props.disabled).toBe(true);

    renderer.unmount();
  });
});
