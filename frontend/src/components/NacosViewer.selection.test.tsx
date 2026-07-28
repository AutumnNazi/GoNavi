import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import NacosViewer from './NacosViewer';
import { nacosConfigSelectionKey } from './nacosConfigSelection';

const rows = [
  { dataId: 'app.yaml', group: 'DEFAULT_GROUP', type: 'yaml' },
  { dataId: 'shared.json', group: 'APP_GROUP', type: 'json' },
];

const storeState = vi.hoisted(() => ({
  connections: [
    {
      id: 'nacos-1',
      name: 'nacos',
      config: {
        type: 'nacos',
        host: '127.0.0.1',
        port: 8848,
      },
    },
  ],
  theme: 'light',
  appearance: {
    uiVersion: 'v2',
    enabled: true,
    opacity: 1,
    blur: 0,
    useNativeMacWindowControls: false,
  },
}));

const nacosBackend = vi.hoisted(() => ({
  NacosSearchConfigs: vi.fn(),
  NacosListConfigGroups: vi.fn(),
  NacosExportConfigs: vi.fn(),
  NacosDeleteConfig: vi.fn(),
}));

const antdState = vi.hoisted(() => ({
  tableProps: [] as any[],
  message: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('../i18n/provider', () => ({
  useOptionalI18n: () => ({ language: 'en-US' }),
}));

vi.mock('../../wailsjs/runtime', () => ({
  EventsOn: vi.fn(() => vi.fn()),
}));

vi.mock('./MonacoEditor', async () => {
  const React = await import('react');
  return { default: () => React.createElement('nacos-editor') };
});

vi.mock('./RedisResizableDivider', async () => {
  const React = await import('react');
  return { default: () => React.createElement('nacos-divider') };
});

vi.mock('@ant-design/icons', async () => {
  const React = await import('react');
  const Icon = () => React.createElement('span', { 'data-icon': true });
  return {
    DeleteOutlined: Icon,
    DownloadOutlined: Icon,
    ExperimentOutlined: Icon,
    HistoryOutlined: Icon,
    PlusOutlined: Icon,
    ReloadOutlined: Icon,
    SaveOutlined: Icon,
    UploadOutlined: Icon,
  };
});

vi.mock('antd', async () => {
  const React = await import('react');
  const passthrough = (tag: string) => ({ children, ...props }: any) =>
    React.createElement(tag, props, children);
  const Button = ({ children, ...props }: any) => React.createElement('button', props, children);
  const Input = Object.assign(
    (props: any) => React.createElement('input', props),
    { TextArea: (props: any) => React.createElement('textarea', props) },
  );
  const Form = Object.assign(
    passthrough('form'),
    {
      Item: passthrough('form-item'),
      useForm: () => [{
        validateFields: vi.fn(),
        resetFields: vi.fn(),
        setFieldsValue: vi.fn(),
      }],
    },
  );
  const Modal = Object.assign(
    ({ open, children, ...props }: any) => open
      ? React.createElement('modal', props, children)
      : null,
    { confirm: vi.fn() },
  );

  return {
    Alert: passthrough('alert'),
    AutoComplete: (props: any) => React.createElement('autocomplete', props),
    Button,
    Checkbox: ({ children, ...props }: any) =>
      React.createElement('checkbox-control', props, children),
    Form,
    Input,
    Modal,
    Popconfirm: ({ children, ...props }: any) =>
      React.createElement('popconfirm', props, children),
    Radio: { Group: passthrough('radio-group') },
    Select: (props: any) => React.createElement('select-control', props),
    Space: passthrough('space'),
    Spin: passthrough('spin'),
    Table: (props: any) => {
      antdState.tableProps.push(props);
      return React.createElement('nacos-table');
    },
    Tag: passthrough('tag'),
    Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
    message: antdState.message,
  };
});

const flushEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

const renderedText = (node: any): string => {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(renderedText).join('');
  if (Array.isArray(node.children)) return node.children.map(renderedText).join('');
  return '';
};

const latestConfigTableProps = () =>
  [...antdState.tableProps].reverse().find((props) => props.className === 'gn-nacos-config-table');

const findButtonByText = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType('button').find((node) => renderedText(node.props.children).includes(text));

describe('NacosViewer config selection actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    antdState.tableProps = [];
    nacosBackend.NacosSearchConfigs.mockResolvedValue({
      success: true,
      data: {
        totalCount: rows.length,
        pageNumber: 1,
        pagesAvailable: 1,
        pageItems: rows,
      },
    });
    nacosBackend.NacosListConfigGroups.mockResolvedValue({
      success: true,
      data: ['DEFAULT_GROUP', 'APP_GROUP'],
    });
    nacosBackend.NacosExportConfigs.mockResolvedValue({
      success: true,
      data: { exported: rows.length },
    });
    nacosBackend.NacosDeleteConfig.mockResolvedValue({ success: true });
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => callback(0),
      getSelection: () => ({ removeAllRanges: vi.fn() }),
      go: { app: { App: nacosBackend } },
    });
    vi.stubGlobal('ResizeObserver', undefined);
  });

  it('switches the single export action between all and selected scopes', async () => {
    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <NacosViewer connectionId="nacos-1" namespaceId="dev" namespaceName="dev" />,
      );
    });
    await flushEffects();

    const exportAll = findButtonByText(renderer!, 'Export all');
    expect(exportAll).toBeTruthy();
    expect(findButtonByText(renderer!, 'Export selected')).toBeUndefined();
    await act(async () => {
      exportAll!.props.onClick();
    });
    await flushEffects();

    expect(nacosBackend.NacosExportConfigs).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: 'all', items: [] }),
    );

    const selectPage = renderer!.root.findByProps({ 'aria-label': 'Select page' });
    await act(async () => {
      selectPage.props.onChange({ target: { checked: true } });
    });

    expect(latestConfigTableProps().rowSelection.selectedRowKeys).toEqual(
      rows.map(nacosConfigSelectionKey),
    );

    expect(findButtonByText(renderer!, 'Export all')).toBeUndefined();
    const exportSelected = findButtonByText(renderer!, 'Export selected');
    expect(exportSelected).toBeTruthy();
    await act(async () => {
      exportSelected!.props.onClick();
    });
    await flushEffects();

    expect(nacosBackend.NacosExportConfigs).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        scope: 'selected',
        items: rows.map(({ dataId, group }) => ({ dataId, group })),
      }),
    );

    renderer!.unmount();
  });

  it('keeps failed rows selected after a partial batch delete', async () => {
    nacosBackend.NacosDeleteConfig.mockImplementation(
      async (_config: unknown, _namespace: string, _group: string, dataId: string) =>
        dataId === 'shared.json'
          ? { success: false, message: 'permission denied' }
          : { success: true },
    );

    let renderer: ReactTestRenderer;
    await act(async () => {
      renderer = create(
        <NacosViewer connectionId="nacos-1" namespaceId="dev" namespaceName="dev" />,
      );
    });
    await flushEffects();

    const selectPage = renderer!.root.findByProps({ 'aria-label': 'Select page' });
    await act(async () => {
      selectPage.props.onChange({ target: { checked: true } });
    });

    const confirmation = renderer!.root.findAll((node) => String(node.type) === 'popconfirm').find(
      (node) => String(node.props.title).includes('Delete the 2 selected configs'),
    );
    expect(confirmation).toBeTruthy();
    const deleteSelected = findButtonByText(renderer!, 'Delete selected');
    expect(deleteSelected).toBeTruthy();
    expect(deleteSelected!.props.danger).toBe(true);
    expect(deleteSelected!.props.type).toBeUndefined();
    await act(async () => {
      await confirmation!.props.onConfirm();
    });
    await flushEffects();

    expect(nacosBackend.NacosDeleteConfig).toHaveBeenCalledTimes(2);
    expect(antdState.message.warning).toHaveBeenCalledWith('Deleted 1 configs; 1 failed');
    expect(latestConfigTableProps().rowSelection.selectedRowKeys).toEqual([
      nacosConfigSelectionKey(rows[1]),
    ]);

    const nextSelectPage = renderer!.root.findByProps({ 'aria-label': 'Select page' });
    expect(nextSelectPage.props.checked).toBe(false);
    expect(nextSelectPage.props.indeterminate).toBe(true);

    renderer!.unmount();
  });
});
