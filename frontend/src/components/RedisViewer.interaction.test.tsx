import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RedisViewer from './RedisViewer';

const storeState = vi.hoisted(() => ({
  connections: [
    {
      id: 'redis-1',
      name: 'redis',
      config: {
        type: 'redis',
        host: '127.0.0.1',
        port: 6379,
        password: '',
        database: '',
      },
    },
  ],
  theme: 'light',
  appearance: {
    enabled: true,
    opacity: 1,
    blur: 0,
    useNativeMacWindowControls: false,
  },
}));

const redisBackend = vi.hoisted(() => ({
  RedisScanKeys: vi.fn(),
  RedisGetValue: vi.fn(),
  RedisListRemove: vi.fn(),
  RedisExportKeys: vi.fn(),
  RedisPreviewImportKeys: vi.fn(),
  RedisImportKeys: vi.fn(),
}));

const antdState = vi.hoisted(() => ({
  treeProps: null as any,
  tableProps: [] as any[],
  message: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('../store', () => {
  const useStore = Object.assign(
    (selector: (state: typeof storeState) => any) => selector(storeState),
    { getState: () => storeState },
  );
  return { useStore };
});

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement('div', { 'data-monaco-editor': true }),
  };
});

vi.mock('@ant-design/icons', async () => {
  const React = await import('react');
  const Icon = () => React.createElement('span', { 'data-icon': true });
  return {
    ReloadOutlined: Icon,
    DeleteOutlined: Icon,
    PlusOutlined: Icon,
    EditOutlined: Icon,
    SearchOutlined: Icon,
    ClockCircleOutlined: Icon,
    CopyOutlined: Icon,
    FolderOpenOutlined: Icon,
    KeyOutlined: Icon,
    RightOutlined: Icon,
    DownOutlined: Icon,
  };
});

vi.mock('antd', async () => {
  const React = await import('react');
  const passthrough = (tag: string) => ({ children, ...props }: any) => React.createElement(tag, props, children);
  const Button = ({ children, ...props }: any) => React.createElement('button', props, children);
  const Input = Object.assign(
    ({ ...props }: any) => React.createElement('input', props),
    {
      Search: ({ ...props }: any) => React.createElement('input', props),
      TextArea: ({ ...props }: any) => React.createElement('textarea', props),
    },
  );
  const FormComponent = Object.assign(
    ({ children, ...props }: any) => React.createElement('form', props, children),
    {
      Item: passthrough('div'),
      useForm: () => [{
        validateFields: vi.fn(),
        resetFields: vi.fn(),
        setFieldsValue: vi.fn(),
      }],
    },
  );

  return {
    Table: (props: any) => {
      antdState.tableProps.push(props);
      return React.createElement('redis-table');
    },
    Input,
    Button,
    Space: Object.assign(passthrough('div'), { Compact: passthrough('div') }),
    Tag: passthrough('span'),
    Tree: (props: any) => {
      antdState.treeProps = props;
      return React.createElement('redis-tree');
    },
    Spin: ({ children }: any) => React.createElement(React.Fragment, null, children),
    message: antdState.message,
    Modal: Object.assign(({ children, open, onOk, onCancel, okButtonProps, title, ...props }: any) => {
      if (!open) {
        return null;
      }
      return React.createElement('div', props, [
        React.createElement('div', { key: 'title', 'data-modal-title': true }, title),
        children,
        onOk ? React.createElement('button', { key: 'ok', onClick: onOk, disabled: okButtonProps?.disabled }, 'modal-ok') : null,
        onCancel ? React.createElement('button', { key: 'cancel', onClick: onCancel }, 'modal-cancel') : null,
      ]);
    }, { confirm: vi.fn() }),
    Form: FormComponent,
    InputNumber: ({ ...props }: any) => React.createElement('input', props),
    Popconfirm: passthrough('span'),
    Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
    Radio: {
      Group: passthrough('div'),
      Button,
    },
  };
});

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const collectRenderedText = (node: any): string => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(collectRenderedText).join('');
  if (Array.isArray(node.children)) return node.children.map(collectRenderedText).join('');
  return '';
};

const findButtonByText = (renderer: ReactTestRenderer, text: string) => {
  return renderer.root.findAllByType('button').find((node) => collectRenderedText(node.props.children).includes(text));
};

const countLeafNodes = (nodes: any[]): number => {
  return nodes.reduce((total, node) => {
    if (!node || typeof node !== 'object') {
      return total;
    }
    if (node.nodeType === 'leaf') {
      return total + 1;
    }
    return total + countLeafNodes(Array.isArray(node.children) ? node.children : []);
  }, 0);
};

const findFirstLeafNode = (nodes: any[]): any | null => {
  for (const node of nodes) {
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (node.nodeType === 'leaf') {
      return node;
    }
    if (Array.isArray(node.children)) {
      const nested = findFirstLeafNode(node.children);
      if (nested) {
        return nested;
      }
    }
  }
  return null;
};

describe('RedisViewer tree interactions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    antdState.treeProps = null;
    antdState.tableProps = [];
    storeState.connections = [
      {
        id: 'redis-1',
        name: 'redis',
        config: {
          type: 'redis',
          host: '127.0.0.1',
          port: 6379,
          password: '',
          database: '',
        },
      },
    ];
    redisBackend.RedisScanKeys.mockResolvedValue({
      success: true,
      data: {
        cursor: '0',
        keys: [
          { key: 'app:user:1', type: 'string', ttl: -1 },
          { key: 'app:user:2', type: 'string', ttl: -1 },
        ],
      },
    });
    redisBackend.RedisGetValue.mockResolvedValue({
      success: true,
      data: { key: 'app:user:1', type: 'string', ttl: -1, value: 'demo' },
    });
    redisBackend.RedisListRemove.mockResolvedValue({ success: true });
    redisBackend.RedisExportKeys.mockResolvedValue({
      success: true,
      data: { exported: 2 },
    });
    redisBackend.RedisPreviewImportKeys.mockResolvedValue({
      success: true,
      data: {
        file: 'C:\\tmp\\redis-keys.json',
        database: 0,
        total: 2,
        keys: [
          { key: 'app:user:1', type: 'string', ttl: -1 },
          { key: 'app:user:2', type: 'string', ttl: 120 },
        ],
      },
    });
    redisBackend.RedisImportKeys.mockResolvedValue({
      success: true,
      data: { imported: 1, skipped: 0, total: 1 },
    });
    vi.stubGlobal('window', {
      innerWidth: 1280,
      innerHeight: 800,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      go: {
        app: {
          App: redisBackend,
        },
      },
    });
    vi.stubGlobal('ResizeObserver', undefined);
  });

  it('toggles namespace expansion from row clicks without checking the group', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={0} />);
    });
    await flushEffects();

    const appGroup = antdState.treeProps.treeData.find((node: any) => node.key === 'group:app');
    expect(appGroup).toBeTruthy();
    // rc-tree maps a click on an unselectable, checkable node to onCheck.
    // Groups must remain selectable so a row click reaches onSelect (which
    // RedisViewer safely ignores for nodes without a raw Redis key).
    expect(appGroup.selectable).not.toBe(false);
    expect(antdState.treeProps.expandedKeys).not.toContain('group:app');

    const groupTitle = antdState.treeProps.titleRender(appGroup);
    expect(typeof groupTitle.props.onClick).toBe('function');

    const event = {
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    };
    await act(async () => {
      groupTitle.props.onClick(event);
    });

    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(antdState.treeProps.expandedKeys).toContain('group:app');
    expect(antdState.treeProps.checkedKeys.checked).toEqual([]);

    renderer!.unmount();
  });

  it('shows Redis Cluster topology context in the key explorer header', async () => {
    storeState.connections = [
      {
        id: 'redis-1',
        name: 'redis-cluster',
        config: {
          type: 'redis',
          host: '10.0.0.1',
          port: 6379,
          hosts: ['10.0.0.2:6379', '10.0.0.3:6379'],
          topology: 'cluster',
          password: '',
          database: '',
        } as any,
      },
    ];

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={2} />);
    });
    await flushEffects();

    const renderedText = collectRenderedText(renderer!.toJSON());
    expect(renderedText).toContain('db2');
    expect(renderedText).toContain('Cluster');
    expect(renderedText).toContain('3 nodes');

    renderer!.unmount();
  });

  it('renders key detail actions on a separate row below the metadata', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={0} />);
    });
    await flushEffects();

    const leafNode = findFirstLeafNode(antdState.treeProps.treeData);
    await act(async () => {
      antdState.treeProps.onSelect?.([leafNode.key]);
    });
    await flushEffects();

    const header = renderer!.root.findByProps({ className: 'redis-key-detail-header' });
    const summary = renderer!.root.findByProps({ className: 'redis-key-detail-summary' });
    const identity = renderer!.root.findByProps({ className: 'redis-key-detail-identity' });
    const metadata = renderer!.root.findByProps({ className: 'redis-key-detail-metadata' });
    const actions = renderer!.root.findByProps({ className: 'redis-key-detail-actions' });

    expect(header.props.style).toMatchObject({ flexDirection: 'column' });
    expect(summary.props.style).toMatchObject({ minWidth: 0, width: '100%' });
    expect(identity.parent).toBe(summary);
    expect(metadata.parent).toBe(summary);
    expect(actions.parent).toBe(summary);
    expect(summary.children.indexOf(identity)).toBeLessThan(summary.children.indexOf(metadata));
    expect(summary.children.indexOf(metadata)).toBeLessThan(summary.children.indexOf(actions));
    expect(actions.props.style).toMatchObject({
      alignSelf: 'flex-start',
      flexWrap: 'wrap',
      maxWidth: '100%',
    });
    expect(findButtonByText(renderer!, 'Set TTL')).toBeTruthy();
    expect(findButtonByText(renderer!, 'Refresh')).toBeTruthy();
    expect(findButtonByText(renderer!, 'Delete Key')).toBeTruthy();

    renderer!.unmount();
  });

  it('loads every key page when the load-all action is clicked', async () => {
    redisBackend.RedisScanKeys.mockReset();
    redisBackend.RedisScanKeys
      .mockResolvedValueOnce({
        success: true,
        data: {
          cursor: '1',
          keys: [
            { key: 'app:user:1', type: 'string', ttl: -1 },
            { key: 'app:user:2', type: 'string', ttl: -1 },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          cursor: '1',
          keys: [
            { key: 'app:user:1', type: 'string', ttl: -1 },
            { key: 'app:user:2', type: 'string', ttl: -1 },
          ],
        },
      })
      .mockResolvedValueOnce({
        success: true,
        data: {
          cursor: '0',
          keys: [
            { key: 'app:user:3', type: 'string', ttl: -1 },
          ],
        },
      });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={0} />);
    });
    await flushEffects();

    const loadAllButton = findButtonByText(renderer!, 'Load all');
    expect(loadAllButton).toBeTruthy();

    await act(async () => {
      loadAllButton!.props.onClick?.();
    });
    await flushEffects();

    expect(redisBackend.RedisScanKeys).toHaveBeenCalledTimes(3);
    expect(redisBackend.RedisScanKeys.mock.calls[1]?.[2]).toBe('0');
    expect(redisBackend.RedisScanKeys.mock.calls[2]?.[2]).toBe('1');

    expect(countLeafNodes(antdState.treeProps.treeData)).toBe(3);

    const renderedText = collectRenderedText(renderer!.toJSON());
    expect(renderedText).toContain('Loaded 3 Keys');

    renderer!.unmount();
  });

  it('exports the current filtered key set when the export-all action is clicked', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={0} />);
    });
    await flushEffects();

    const exportAllButton = findButtonByText(renderer!, 'Export all');
    expect(exportAllButton).toBeTruthy();

    await act(async () => {
      exportAllButton!.props.onClick?.();
    });
    await flushEffects();

    expect(redisBackend.RedisExportKeys).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'redis', host: '127.0.0.1', port: 6379, redisDB: 0 }),
      { scope: 'all', keys: [], pattern: '*' },
    );

    renderer!.unmount();
  });

  it('exports checked leaf keys when the export-selected action is clicked', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={0} />);
    });
    await flushEffects();

    const leafNode = findFirstLeafNode(antdState.treeProps.treeData);
    expect(leafNode?.rawKey).toBe('app:user:1');

    await act(async () => {
      antdState.treeProps.onCheck?.(
        { checked: [leafNode.key], halfChecked: [] },
        { checked: true, node: leafNode },
      );
    });
    await flushEffects();

    const exportSelectedButton = findButtonByText(renderer!, 'Export selected');
    expect(exportSelectedButton).toBeTruthy();
    expect(exportSelectedButton?.props.disabled).toBe(false);

    await act(async () => {
      exportSelectedButton!.props.onClick?.();
    });
    await flushEffects();

    expect(redisBackend.RedisExportKeys).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'redis', host: '127.0.0.1', port: 6379, redisDB: 0 }),
      { scope: 'selected', keys: ['app:user:1'], pattern: '*' },
    );

    renderer!.unmount();
  });

  it('imports only the checked preview keys from the selected file', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={0} />);
    });
    await flushEffects();

    const importButton = findButtonByText(renderer!, 'Import');
    expect(importButton).toBeTruthy();

    await act(async () => {
      importButton!.props.onClick?.();
    });
    await flushEffects();

    const chooseFileButton = findButtonByText(renderer!, 'Select import file');
    expect(chooseFileButton).toBeTruthy();

    await act(async () => {
      chooseFileButton!.props.onClick?.();
    });
    await flushEffects();

    expect(redisBackend.RedisPreviewImportKeys).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'redis', host: '127.0.0.1', port: 6379, redisDB: 0 }),
    );

    const secondCheckbox = renderer!.root.findByProps({ 'data-import-key': 'app:user:2' });
    await act(async () => {
      secondCheckbox.props.onChange?.({ target: { checked: false } });
    });
    await flushEffects();

    const modalOkButton = findButtonByText(renderer!, 'modal-ok');
    expect(modalOkButton).toBeTruthy();
    expect(modalOkButton?.props.disabled).toBe(false);

    await act(async () => {
      modalOkButton!.props.onClick?.();
    });
    await flushEffects();

    expect(redisBackend.RedisImportKeys).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'redis', host: '127.0.0.1', port: 6379, redisDB: 0 }),
      {
        conflictMode: 'overwrite',
        file: 'C:\\tmp\\redis-keys.json',
        scope: 'selected',
        keys: ['app:user:1'],
      },
    );

    renderer!.unmount();
  });

  it('removes one selected List value', async () => {
    redisBackend.RedisGetValue.mockResolvedValue({
      success: true,
      data: { key: 'app:user:1', type: 'list', ttl: -1, value: ['todo', 'review'] },
    });

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(<RedisViewer connectionId="redis-1" redisDB={0} />);
    });
    await flushEffects();

    const leafNode = findFirstLeafNode(antdState.treeProps.treeData);
    await act(async () => {
      antdState.treeProps.onSelect?.([leafNode.key]);
    });
    await flushEffects();

    const listTables = antdState.tableProps.filter((props) =>
      Array.isArray(props.dataSource) && props.dataSource[0]?.value === 'todo',
    );
    const listTable = listTables[listTables.length - 1];
    expect(listTable).toBeTruthy();
    const actionColumn = listTable.columns.find((column: any) => column.key === 'action');
    let actionRenderer: ReactTestRenderer;
    await act(async () => {
      actionRenderer = create(actionColumn.render(null, { index: 1, value: 'review' }));
    });
    const confirmation = actionRenderer!.root
      .findAllByType('span')
      .find((node) => typeof node.props.onConfirm === 'function');
    expect(confirmation).toBeTruthy();

    await act(async () => {
      await confirmation!.props.onConfirm();
    });
    await flushEffects();

    expect(redisBackend.RedisListRemove).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'redis', host: '127.0.0.1', port: 6379, redisDB: 0 }),
      'app:user:1',
      'review',
    );
    expect(antdState.message.success).toHaveBeenCalledWith('Deleted');

    actionRenderer!.unmount();
    renderer!.unmount();
  });
});
