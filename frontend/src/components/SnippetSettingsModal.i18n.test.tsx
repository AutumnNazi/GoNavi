import { readFileSync } from 'node:fs';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '../i18n/provider';
import type { OverlayWorkbenchTheme } from '../utils/overlayWorkbenchTheme';
import SnippetSettingsModal from './SnippetSettingsModal';

const source = readFileSync(new URL('./SnippetSettingsModal.tsx', import.meta.url), 'utf8');

const storeState = vi.hoisted(() => ({
  sqlSnippets: [] as Array<Record<string, unknown>>,
  saveSqlSnippet: vi.fn(),
  deleteSqlSnippet: vi.fn(),
  resetBuiltinSqlSnippet: vi.fn(),
}));

const messageApi = vi.hoisted(() => ({
  warning: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../store', () => ({
  useStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
}));

vi.mock('../i18n/runtime', () => ({
  syncLanguageRuntime: vi.fn(async () => undefined),
}));

vi.mock('antd', async () => {
  const React = await import('react');

  const Button = ({
    children,
    icon,
    onClick,
    ...props
  }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
  }) => React.createElement('button', { ...props, onClick }, icon, children);

  const Input = ({
    value,
    onChange,
    placeholder,
    ...props
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    placeholder?: string;
  }) => React.createElement('input', {
    ...props,
    value,
    placeholder,
    onChange: (event: { target: { value: string } }) => onChange?.(event),
  });

  Input.TextArea = ({
    value,
    onChange,
    placeholder,
    children,
    ...props
  }: {
    value?: string;
    onChange?: (event: { target: { value: string } }) => void;
    placeholder?: string;
    children?: React.ReactNode;
  }) => React.createElement('textarea', {
    ...props,
    value,
    placeholder,
    onChange: (event: { target: { value: string } }) => onChange?.(event),
  }, children);

  const List = ({
    dataSource,
    renderItem,
  }: {
    dataSource: unknown[];
    renderItem: (item: unknown) => React.ReactNode;
  }) => React.createElement(
    'div',
    null,
    dataSource.map((item, index) => React.createElement(React.Fragment, { key: index }, renderItem(item))),
  );
  List.Item = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
  }) => React.createElement('div', props, children);

  const Tag = ({
    children,
    ...props
  }: {
    children?: React.ReactNode;
  }) => React.createElement('span', props, children);

  const Popconfirm = ({
    title,
    description,
    children,
  }: {
    title?: React.ReactNode;
    description?: React.ReactNode;
    children?: React.ReactNode;
  }) => React.createElement('div', null, title, description, children);

  const Collapse = ({
    items,
  }: {
    items?: Array<{ key: string; label: React.ReactNode; children: React.ReactNode }>;
  }) => React.createElement(
    'div',
    null,
    items?.map((item) => React.createElement('section', { key: item.key }, item.label, item.children)),
  );

  const Typography = {
    Text: ({
      children,
      ...props
    }: {
      children?: React.ReactNode;
    }) => React.createElement('code', props, children),
  };

  return {
    Modal: ({
      open,
      title,
      children,
    }: {
      open?: boolean;
      title?: React.ReactNode;
      children?: React.ReactNode;
    }) => (open ? React.createElement('div', null, title, children) : null),
    Button,
    Input,
    List,
    Tag,
    Popconfirm,
    message: messageApi,
    Collapse,
    Typography,
  };
});

vi.mock('@ant-design/icons', async () => {
  const React = await import('react');
  return {
    PlusOutlined: () => React.createElement('span', null, 'plus'),
    DeleteOutlined: () => React.createElement('span', null, 'delete'),
    UndoOutlined: () => React.createElement('span', null, 'undo'),
    SaveOutlined: () => React.createElement('span', null, 'save'),
    CodeOutlined: () => React.createElement('span', null, 'code'),
  };
});

const locales = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'de-DE', 'ru-RU'] as const;
const requiredKeys = [
  'snippet_settings.list.title',
  'snippet_settings.action.new',
  'snippet_settings.action.reset',
  'snippet_settings.action.delete',
  'snippet_settings.action.save',
  'snippet_settings.action.close',
  'snippet_settings.tag.builtin',
  'snippet_settings.field.prefix.label',
  'snippet_settings.field.prefix.placeholder',
  'snippet_settings.field.name.label',
  'snippet_settings.field.name.placeholder',
  'snippet_settings.field.description.label',
  'snippet_settings.field.description.placeholder',
  'snippet_settings.field.body.label',
  'snippet_settings.empty_state',
  'snippet_settings.syntax_help.label',
  'snippet_settings.syntax_help.placeholder',
  'snippet_settings.syntax_reference.label',
  'snippet_settings.syntax_reference.first_tabstop',
  'snippet_settings.syntax_reference.second_tabstop',
  'snippet_settings.syntax_reference.final_cursor',
  'snippet_settings.syntax_reference.linked_tabstop',
  'snippet_settings.syntax_reference.builtin_variables',
  'snippet_settings.syntax_reference.current_date',
  'snippet_settings.syntax_reference.current_time',
  'snippet_settings.syntax_reference.unix_seconds',
  'snippet_settings.syntax_reference.uuid',
  'snippet_settings.syntax_reference.random',
  'snippet_settings.syntax_reference.example',
  'snippet_settings.confirm.reset.title',
  'snippet_settings.confirm.reset.description',
  'snippet_settings.confirm.delete.title',
  'snippet_settings.confirm.delete.description',
  'snippet_settings.message.prefix_required',
  'snippet_settings.message.name_required',
  'snippet_settings.message.body_required',
  'snippet_settings.message.prefix_duplicate',
  'snippet_settings.message.saved',
  'snippet_settings.message.deleted',
  'snippet_settings.message.reset_default',
] as const;

const overlayTheme: OverlayWorkbenchTheme = {
  isDark: false,
  shellBg: '#fff',
  shellBorder: '1px solid #eee',
  shellShadow: 'none',
  shellBackdropFilter: 'none',
  sectionBg: '#fff',
  sectionBorder: '1px solid #eee',
  mutedText: '#666',
  titleText: '#111',
  iconBg: '#f5f5f5',
  iconColor: '#1677ff',
  hoverBg: '#f5f5f5',
  selectedBg: '#e6f4ff',
  selectedText: '#1677ff',
  divider: '#eee',
};

const renderModal = async (props: Partial<React.ComponentProps<typeof SnippetSettingsModal>> = {}) => {
  let renderer: ReturnType<typeof create>;

  await act(async () => {
    renderer = create(
      <I18nProvider
        preference="en-US"
        systemLanguages={['en-US']}
        onPreferenceChange={() => undefined}
      >
        <SnippetSettingsModal
          open
          onClose={() => undefined}
          darkMode={false}
          overlayTheme={overlayTheme}
          {...props}
        />
      </I18nProvider>,
    );
  });

  return renderer!;
};

const getText = (node: any): string => (
  (node.children || [])
    .map((child: any) => (typeof child === 'string' ? child : getText(child)))
    .join('')
);

const getJsonText = (node: any): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((item) => getJsonText(item)).join('');
  return (node.children || []).map((child: any) => getJsonText(child)).join('');
};

describe('SnippetSettingsModal i18n', () => {
  beforeEach(() => {
    storeState.sqlSnippets = [];
    storeState.saveSqlSnippet.mockReset();
    storeState.deleteSqlSnippet.mockReset();
    storeState.resetBuiltinSqlSnippet.mockReset();
    messageApi.warning.mockReset();
    messageApi.success.mockReset();
  });

  it('localizes shell, action and feedback source strings instead of keeping hard-coded Chinese copy', () => {
    expect(source).toContain("const { t } = useI18n();");
    expect(source).toContain("t('app.tools.entry.snippets.title')");
    expect(source).toContain("t('app.tools.entry.snippets.description')");
    expect(source).toContain("t('snippet_settings.list.title')");
    expect(source).toContain("t('snippet_settings.action.new')");
    expect(source).toContain("message.warning(t('snippet_settings.message.prefix_required'))");
    expect(source).toContain("message.warning(t('snippet_settings.message.name_required'))");
    expect(source).toContain("message.warning(t('snippet_settings.message.body_required'))");
    expect(source).toContain("message.success(t('snippet_settings.message.saved'))");
    expect(source).toContain("message.success(t('snippet_settings.message.deleted'))");
    expect(source).toContain("message.success(t('snippet_settings.message.reset_default'))");
    expect(source).toContain("t('snippet_settings.syntax_help.label')");
    expect(source).toContain("t('snippet_settings.syntax_help.placeholder')");
    expect(source).toContain("t('snippet_settings.syntax_reference.label')");
    expect(source).toContain("t('snippet_settings.syntax_reference.first_tabstop')");
    expect(source).toContain("t('snippet_settings.syntax_reference.example')");

    expect(source).not.toContain("void message.warning('前缀不能为空')");
    expect(source).not.toContain("void message.warning('名称不能为空')");
    expect(source).not.toContain("void message.warning('片段内容不能为空')");
    expect(source).not.toContain("void message.success('片段已保存')");
    expect(source).not.toContain("void message.success('片段已删除')");
    expect(source).not.toContain("void message.success('已重置为默认')");
    expect(source).not.toContain('代码片段管理');
    expect(source).not.toContain('管理 SQL 代码片段，输入前缀后按 Tab 展开');
    expect(source).not.toContain('片段列表');
    expect(source).not.toContain('新建片段');
    expect(source).not.toContain('选择左侧片段编辑，或点击「新建片段」');
    expect(source).not.toContain('重置为默认');
    expect(source).not.toContain('删除片段');
    expect(source).not.toContain('保存');
    expect(source).not.toContain('关闭');
    expect(source).not.toContain('片段语法说明（可编辑）');
    expect(source).not.toContain('展示在补全详情中的用法说明，例如占位符含义、参数约定或注意事项');
    expect(source).not.toContain('占位符语法参考');
    expect(source).not.toContain('第一个 Tab 位，占位符为提示文字');
    expect(source).not.toContain('第二个 Tab 位，默认值可直接确认');
    expect(source).not.toContain('最终光标位置');
    expect(source).not.toContain('同一数字在多处出现时会同步编辑');
    expect(source).not.toContain('内置变量（展开时自动替换为实际值）：');
    expect(source).not.toContain('当前日期');
    expect(source).not.toContain('当前时间');
    expect(source).not.toContain('Unix 时间戳');
    expect(source).not.toContain('随机 UUID');
    expect(source).not.toContain('6 位随机数');
    expect(source).not.toContain('示例：SELECT');
  });

  it('keeps snippet editor content scrollable without clipping the action row', () => {
    expect(source).toContain("const snippetModalBodyMaxHeight = 'calc(100vh - 128px)';");
    expect(source).toContain("const snippetModalEmbeddedBodyMaxHeight = '100%';");
    expect(source).toContain("const snippetSyntaxReferenceMaxHeight = 'min(220px, 32vh)';");
    expect(source).toContain('maxHeight: embedded ? snippetModalEmbeddedBodyMaxHeight : snippetModalBodyMaxHeight');
    expect(source).toContain('data-sql-snippet-syntax-reference-scroll-region="true"');
    expect(source).toContain('data-sql-snippet-editor-panel-scroll-region="true"');
    expect(source).toContain('data-sql-snippet-content-region="true"');
    expect(source).toContain('data-sql-snippet-editor-scroll-region="true"');
    expect(source).toContain("overflowY: 'auto'");
    expect(source).toContain("flex: '0 0 auto'");
    expect(source).toContain('height: 220');
    expect(source).toContain('maxHeight: 260');
  });

  it('lets the tool center provide the title when embedded', async () => {
    const renderer = await renderModal({ embedded: true });
    const root = renderer.root;

    expect(() => root.findByProps({ className: 'gn-embedded-modal-header' })).toThrow();
    expect(getJsonText(renderer.toJSON())).toContain('Select a snippet on the left to edit, or click "New Snippet"');

    const standaloneRenderer = await renderModal();
    const standaloneText = getJsonText(standaloneRenderer.toJSON());
    expect(standaloneText).toContain('Snippet Management');
    expect(standaloneText).toContain('Manage SQL snippets and prefix completion.');
  });

  it('keeps the shell and feedback keys available in every locale', () => {
    locales.forEach((locale) => {
      const catalog = JSON.parse(readFileSync(new URL(`../../../shared/i18n/${locale}.json`, import.meta.url), 'utf8')) as Record<string, string>;
      requiredKeys.forEach((key) => {
        expect(catalog[key], `${locale}:${key}`).toBeTruthy();
      });
    });
  });

  it('renders the modal shell in English and localizes save validation feedback', async () => {
    const renderer = await renderModal();
    const initialText = getJsonText(renderer.toJSON());
    expect(initialText).toContain('Snippet Management');
    expect(initialText).toContain('Manage SQL snippets and prefix completion.');
    expect(initialText).toContain('Snippet List');
    expect(initialText).toContain('New Snippet');
    expect(initialText).toContain('Select a snippet on the left to edit, or click "New Snippet"');

    const newButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('New Snippet'))[0];

    await act(async () => {
      newButton.props.onClick();
    });

    const editorText = getJsonText(renderer.toJSON());
    expect(editorText).toContain('Save');
    expect(editorText).toContain('Close');
    expect(editorText).toContain('Prefix');
    expect(editorText).toContain('Name');
    expect(editorText).toContain('Description (optional)');
    expect(editorText).toContain('Snippet Body');
    expect(editorText).toContain('Snippet syntax notes (editable)');
    expect(editorText).toContain('Placeholder syntax reference');
    expect(editorText).toContain('Built-in variables (auto-replaced when expanded):');
    expect(editorText).toContain('Example: SELECT ${1:column_name} FROM ${2:table_name}');

    const saveButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('Save'))[0];

    await act(async () => {
      saveButton.props.onClick();
    });

    expect(messageApi.warning).toHaveBeenCalledWith('Prefix is required');
  });

  it('renders a bounded content region and fixed action row for long syntax help', async () => {
    const renderer = await renderModal();

    const newButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('New Snippet'))[0];

    await act(async () => {
      newButton.props.onClick();
    });

    const contentRegion = renderer.root.findByProps({ 'data-sql-snippet-content-region': 'true' });
    const editorPanelScrollRegion = renderer.root.findByProps({ 'data-sql-snippet-editor-panel-scroll-region': 'true' });
    const editorScrollRegion = renderer.root.findByProps({ 'data-sql-snippet-editor-scroll-region': 'true' });
    const syntaxReferenceScrollRegion = renderer.root.findByProps({ 'data-sql-snippet-syntax-reference-scroll-region': 'true' });
    const actionRow = renderer.root.findByProps({ 'data-sql-snippet-action-row': 'true' });

    expect(contentRegion.props.style).toMatchObject({
      flex: '1 1 420px',
      minHeight: 0,
      overflow: 'hidden',
    });
    expect(editorPanelScrollRegion.props.style).toMatchObject({
      height: '100%',
      minHeight: 0,
      overflowY: 'auto',
      overflowX: 'hidden',
      overscrollBehavior: 'contain',
    });
    expect(editorScrollRegion.props.style).toMatchObject({
      flex: '0 0 auto',
      minHeight: 0,
      marginTop: 10,
    });
    expect(syntaxReferenceScrollRegion.props.style).toMatchObject({
      maxHeight: 'min(220px, 32vh)',
      overflowY: 'auto',
      overflowX: 'hidden',
      overscrollBehavior: 'contain',
    });
    expect(actionRow.props.style).toMatchObject({
      flex: '0 0 auto',
      gap: 10,
      justifyContent: 'flex-end',
      paddingTop: 8,
      marginTop: 8,
    });
  });

  it('uses the full embedded body height and keeps the action row outside the scrollable content', async () => {
    const renderer = await renderModal({ embedded: true });

    const newButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('New Snippet'))[0];

    await act(async () => {
      newButton.props.onClick();
    });

    const embeddedBody = renderer.root.findByProps({ className: 'gn-embedded-modal-body' });
    const contentRegion = renderer.root.findByProps({ 'data-sql-snippet-content-region': 'true' });
    const actionRow = renderer.root.findByProps({ 'data-sql-snippet-action-row': 'true' });

    expect(embeddedBody.props.style).toMatchObject({
      height: '100%',
      maxHeight: '100%',
      minHeight: 0,
      overflow: 'hidden',
    });
    expect(contentRegion.props.style).toMatchObject({
      flex: '1 1 0',
      minHeight: 0,
      overflow: 'hidden',
    });
    expect(actionRow.props.style).toMatchObject({
      flex: '0 0 auto',
      gap: 8,
      paddingTop: 12,
      marginTop: 0,
    });
  });

  it('uses a flat master-detail workspace only when embedded', async () => {
    const embeddedRenderer = await renderModal({ embedded: true, onBack: () => undefined });
    const embeddedContent = embeddedRenderer.root.findByProps({ 'data-sql-snippet-content-region': 'true' });
    const embeddedMaster = embeddedRenderer.root.findByProps({ 'data-sql-snippet-master-panel': 'true' });

    expect(embeddedContent.props.style).toMatchObject({
      gap: 0,
      borderTop: overlayTheme.sectionBorder,
      fontFamily: 'var(--gn-font-sans)',
    });
    expect(embeddedMaster.props.style).toMatchObject({
      width: 196,
      borderRadius: 0,
      border: 'none',
      borderRight: overlayTheme.sectionBorder,
      background: 'transparent',
    });

    const newButton = embeddedRenderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('New Snippet'))[0];
    await act(async () => {
      newButton.props.onClick();
    });

    const embeddedEditor = embeddedRenderer.root.findByProps({ 'data-sql-snippet-editor-panel-scroll-region': 'true' });
    const syntaxHelpEditor = embeddedRenderer.root.findByProps({ 'data-sql-snippet-syntax-help-editor': 'true' });
    expect(embeddedEditor.props.style).toMatchObject({
      padding: '0 4px 0 16px',
      borderRadius: 0,
      border: 'none',
      background: 'transparent',
    });
    expect(syntaxHelpEditor.props.style).toMatchObject({
      fontFamily: 'var(--gn-font-sans)',
    });

    const embeddedActionLabels = embeddedRenderer.root
      .findAll((node: any) => node.type === 'button')
      .map((node: any) => getText(node));
    const backIndex = embeddedActionLabels.findIndex((label) => label.includes('Back'));
    const closeIndex = embeddedActionLabels.findIndex((label) => label.includes('Close'));
    const saveIndex = embeddedActionLabels.findIndex((label) => label.includes('Save'));
    expect(backIndex).toBeGreaterThan(-1);
    expect(backIndex).toBeLessThan(closeIndex);
    expect(closeIndex).toBeLessThan(saveIndex);

    const standaloneRenderer = await renderModal();
    const standaloneMaster = standaloneRenderer.root.findByProps({ 'data-sql-snippet-master-panel': 'true' });
    expect(standaloneMaster.props.style).toMatchObject({
      width: 220,
      borderRadius: 14,
      border: overlayTheme.sectionBorder,
      background: overlayTheme.sectionBg,
    });
  });

  it('uses compact action buttons so the footer does not consume editor height', async () => {
    const renderer = await renderModal({ embedded: true, onBack: () => undefined });

    const newButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('New Snippet'))[0];

    await act(async () => {
      newButton.props.onClick();
    });

    const saveButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('Save'))[0];
    const closeButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('Close'))[0];
    const backButton = renderer.root.findAll((node: any) => node.type === 'button' && getText(node).includes('Back'))[0];

    expect(saveButton.props.size).toBe('middle');
    expect(saveButton.props.style).toMatchObject({ minWidth: 84 });
    expect(closeButton.props.size).toBe('middle');
    expect(closeButton.props.style).toMatchObject({ minWidth: 84 });
    expect(backButton.props.size).toBe('middle');
    expect(backButton.props.style).toMatchObject({ minWidth: 96 });
  });
});
