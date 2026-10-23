import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import { NacosConfigDetailPane } from './NacosConfigDetailPane';

const messageMock = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../MonacoEditor', async () => {
  const React = await import('react');
  return { default: (props: any) => React.createElement('nacos-editor', props) };
});

vi.mock('@ant-design/icons', async () => {
  const React = await import('react');
  const Icon = () => React.createElement('span', { 'data-icon': true });
  return {
    CloseOutlined: Icon,
    CloudSyncOutlined: Icon,
    CompressOutlined: Icon,
    DeleteOutlined: Icon,
    ExperimentOutlined: Icon,
    ExportOutlined: Icon,
    FormatPainterOutlined: Icon,
    HistoryOutlined: Icon,
    ImportOutlined: Icon,
    ReloadOutlined: Icon,
    SaveOutlined: Icon,
  };
});

vi.mock('antd', async () => {
  const React = await import('react');
  const passthrough = (tag: string) => ({ children, ...props }: any) =>
    React.createElement(tag, props, children);
  const Button = ({ children, ...props }: any) => React.createElement('button', props, children);
  const Modal = ({ open, children, footer, title, ...props }: any) =>
    open
      ? React.createElement('modal', props, title, children, footer)
      : null;

  return {
    Button,
    Input: Object.assign(
      (props: any) => React.createElement('input', props),
      { TextArea: (props: any) => React.createElement('textarea', props) },
    ),
    Modal,
    Popconfirm: ({ children, ...props }: any) => React.createElement('popconfirm', props, children),
    Radio: { Group: passthrough('radio-group') },
    Select: (props: any) => React.createElement('select-control', props),
    Space: passthrough('space'),
    Spin: passthrough('spin'),
    Tag: passthrough('tag'),
    Tooltip: ({ children }: any) => React.createElement(React.Fragment, null, children),
    message: messageMock,
  };
});

const tr = (key: string) => key;
const BACKSLASH = String.fromCharCode(92);
const NL = String.fromCharCode(10);

const createProps = (overrides: Record<string, unknown> = {}) => ({
  detail: { dataId: 'app.json', group: 'DEFAULT_GROUP', content: '{"a":1}', type: 'json', md5: 'md5' },
  workbenchTheme: { textPrimary: '#000', textMuted: '#888' },
  betaExists: false,
  tr,
  openHistory: vi.fn(),
  publishing: false,
  readOnly: false,
  draftDirty: false,
  handlePublish: vi.fn(),
  publishMode: 'formal',
  handleDelete: vi.fn(),
  remoteChanged: false,
  remoteChangedHint: '',
  handleReloadRemote: vi.fn(),
  setRemoteChanged: vi.fn(),
  loadingDetail: false,
  draftType: 'json',
  setDraftType: vi.fn(),
  setDraftDirty: vi.fn(),
  setPublishMode: vi.fn(),
  betaIps: '',
  setBetaIps: vi.fn(),
  handleLoadBetaContent: vi.fn(),
  handleStopBeta: vi.fn(),
  darkMode: false,
  draftContent: '{"a":1}',
  setDraftContent: vi.fn(),
  ...overrides,
});

const flushEffects = async () => {
  await act(async () => {
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

const findButtonByExactText = (renderer: ReactTestRenderer, text: string) =>
  renderer.root.findAllByType('button').find((node) => renderedText(node.props.children) === text);

const renderPane = async (overrides: Record<string, unknown> = {}) => {
  let renderer: ReactTestRenderer;
  await act(async () => {
    renderer = create(<NacosConfigDetailPane {...(createProps(overrides) as any)} />);
  });
  return renderer!;
};

const findConfigEditor = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => (node.type as any) === 'nacos-editor' && node.props.height === '100%')[0];

const findModalEditor = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => (node.type as any) === 'nacos-editor' && node.props.height === '56vh')[0];

const mountConfigEditor = async (renderer: ReactTestRenderer, selectedText: string) => {
  const range = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 10 };
  const contextKey = { set: vi.fn(), reset: vi.fn() };
  const action = { dispose: vi.fn() };
  const editor: any = {
    addAction: vi.fn((_action: any) => action),
    createContextKey: vi.fn(() => contextKey),
    getModel: vi.fn(() => ({ getValueInRange: vi.fn(() => selectedText) })),
    getSelection: vi.fn(() => range),
    onDidChangeCursorSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeModelContent: vi.fn(() => ({ dispose: vi.fn() })),
    executeEdits: vi.fn(),
    focus: vi.fn(),
  };
  await act(async () => {
    findConfigEditor(renderer).props.onMount(editor, {});
  });
  await flushEffects();
  return { editor, contextKey, action, range };
};

describe('NacosConfigDetailPane JSON parser', () => {
  it('registers a selection-gated JSON parser action on the config editor', async () => {
    const renderer = await renderPane();
    const { editor } = await mountConfigEditor(renderer, '{"a":1}');

    expect(editor.addAction).toHaveBeenCalledWith(expect.objectContaining({
      id: 'gonavi.nacos.openJsonParser',
      label: 'nacos_viewer.action.json_parser',
      precondition: 'gonaviNacosJsonSelection',
      contextMenuGroupId: '1_modification',
    }));
  });

  it('opens the modal with the selected JSON and applies the transforms', async () => {
    const renderer = await renderPane();
    const { editor, range } = await mountConfigEditor(renderer, '{"a":1}');

    await act(async () => {
      editor.addAction.mock.calls[0][0].run();
    });

    const openedEditor = findModalEditor(renderer);
    expect(openedEditor).toBeTruthy();
    expect(openedEditor.props.value).toBe('{"a":1}');

    await act(async () => {
      findButtonByExactText(renderer, 'nacos_viewer.json_parser.compact')!.props.onClick();
    });
    expect(findModalEditor(renderer).props.value).toBe('{"a":1}');

    await act(async () => {
      findButtonByExactText(renderer, 'nacos_viewer.json_parser.format')!.props.onClick();
    });
    const formatted = '{' + NL + '  "a": 1' + NL + '}';
    expect(findModalEditor(renderer).props.value).toBe(formatted);

    await act(async () => {
      findButtonByExactText(renderer, 'nacos_viewer.json_parser.escape')!.props.onClick();
    });
    expect(findModalEditor(renderer).props.value).toContain(BACKSLASH);

    await act(async () => {
      findButtonByExactText(renderer, 'nacos_viewer.json_parser.unescape')!.props.onClick();
    });
    expect(findModalEditor(renderer).props.value).toBe(formatted);

    await act(async () => {
      findButtonByExactText(renderer, 'nacos_viewer.json_parser.apply')!.props.onClick();
    });
    expect(editor.executeEdits).toHaveBeenCalledWith(
      'gonavi.nacos.jsonParser',
      [expect.objectContaining({ range, text: formatted })],
    );
    expect(findModalEditor(renderer)).toBeUndefined();
  });

  it('does not open the modal for a non-JSON selection', async () => {
    const renderer = await renderPane();
    const { editor } = await mountConfigEditor(renderer, 'hello');

    await act(async () => {
      editor.addAction.mock.calls[0][0].run();
    });

    expect(findModalEditor(renderer)).toBeUndefined();
  });

  it('does not write back when the value is unchanged', async () => {
    const renderer = await renderPane();
    const { editor } = await mountConfigEditor(renderer, '{"a":1}');

    await act(async () => {
      editor.addAction.mock.calls[0][0].run();
    });
    await act(async () => {
      findButtonByExactText(renderer, 'nacos_viewer.json_parser.apply')!.props.onClick();
    });

    expect(editor.executeEdits).not.toHaveBeenCalled();
    expect(findModalEditor(renderer)).toBeUndefined();
  });

  it('disables apply when the connection is read-only', async () => {
    const renderer = await renderPane({ readOnly: true });
    const { editor } = await mountConfigEditor(renderer, '{"a":1}');

    await act(async () => {
      editor.addAction.mock.calls[0][0].run();
    });

    expect(findModalEditor(renderer)).toBeTruthy();
    expect(findButtonByExactText(renderer, 'nacos_viewer.json_parser.apply')!.props.disabled).toBe(true);
  });

  it('reports an error when formatting invalid JSON', async () => {
    const renderer = await renderPane();
    const { editor } = await mountConfigEditor(renderer, '{"a":1}');

    await act(async () => {
      editor.addAction.mock.calls[0][0].run();
    });
    await act(async () => {
      findModalEditor(renderer).props.onChange('{invalid');
    });
    await act(async () => {
      findButtonByExactText(renderer, 'nacos_viewer.json_parser.format')!.props.onClick();
    });

    expect(messageMock.error).toHaveBeenCalledWith(
      'nacos_viewer.message.json_parser_invalid_json',
    );
  });
});
