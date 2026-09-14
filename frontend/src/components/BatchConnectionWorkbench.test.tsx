import React from 'react';
import { Alert, Select } from 'antd';
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
  removeConnection: mockRemoveConnection,
  closeTabsByConnection: mockCloseTabsByConnection,
});

let mockStoreState = createMockStoreState();
const deleteConnections = vi.fn().mockResolvedValue(undefined);

vi.mock('antd', async () => {
  const { createElement } = await import('react');
  const component = (tag: string) => ({ children, ...props }: any) => createElement(tag, props, children);
  return {
    Alert: component('mock-alert'),
    Button: component('mock-button'),
    Select: component('mock-select'),
    Tooltip: component('mock-tooltip'),
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
  };
});

vi.mock('../store', () => ({
  useStore: (selector: (state: any) => any) => selector(mockStoreState),
}));

const flushAsyncWork = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

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

  it('prefills saved connections and keeps the delete action disabled until a target is chosen', async () => {
    const renderer = await renderWorkbench();
    const select = renderer.root.findByType(Select);
    const deleteButton = renderer.root.findByProps({ 'data-batch-delete-connections': 'true' });

    expect(renderer.root.findByProps({ 'data-batch-connection-workbench': 'true' })).toBeTruthy();
    expect(select.props.mode).toBe('multiple');
    expect(select.props.options.map((item: { value: string }) => item.value)).toEqual(['conn-3', 'conn-1', 'conn-2']);
    expect(deleteButton.props.disabled).toBe(true);

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
    expect(renderer.root.findByType(Select).props.value).toEqual([]);

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
    expect(renderer.root.findByType(Select).props.value).toEqual(['conn-1', 'conn-3']);
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

    expect(renderer.root.findAllByType(Alert).some((node) => (
      String(node.props.message || '').includes('没有可删除的连接')
    ))).toBe(true);
    expect(renderer.root.findByProps({ 'data-batch-delete-connections': 'true' }).props.disabled).toBe(true);

    renderer.unmount();
  });
});
