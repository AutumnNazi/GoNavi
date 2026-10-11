import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';

import DatabaseSchemaVisibilityModal from './DatabaseSchemaVisibilityModal';

vi.mock('../../i18n', () => ({
  t: (key: string) => key,
}));

vi.mock('../common/ResizableDraggableModal', () => ({
  default: ({ children, ...props }: any) => (
    <section data-component="modal" {...props}>{children}</section>
  ),
}));

vi.mock('@ant-design/icons', () => ({
  DatabaseOutlined: () => <span data-icon="database" />,
  FolderOpenOutlined: () => <span data-icon="folder-open" />,
  ReloadOutlined: () => <span data-icon="reload" />,
  SearchOutlined: () => <span data-icon="search" />,
}));

vi.mock('antd', () => {
  const Space: any = ({ children }: any) => <div data-component="space">{children}</div>;
  Space.Compact = ({ children }: any) => <div data-component="space-compact">{children}</div>;

  const Input: any = (props: any) => <input {...props} />;
  Input.TextArea = (props: any) => <textarea {...props} />;

  const Tree = ({ treeData, ...props }: any) => (
    <div data-component="tree" {...props}>
      {(treeData || []).map((node: any) => (
        <div data-component="tree-node" key={String(node.key)}>
          {node.title}
          {(node.children || []).map((child: any) => (
            <div data-component="tree-node" key={String(child.key)}>{child.title}</div>
          ))}
        </div>
      ))}
    </div>
  );

  return {
    Alert: ({ children, ...props }: any) => <div data-component="alert" {...props}>{children}</div>,
    Button: ({ children, ...props }: any) => <button type="button" {...props}>{children}</button>,
    Checkbox: ({ children, ...props }: any) => (
      <label data-component="checkbox" {...props}>{children}</label>
    ),
    Empty: ({ description }: any) => <div data-component="empty">{description}</div>,
    Input,
    Space,
    Spin: () => <span data-component="spin" />,
    Tag: ({ children }: any) => <span data-component="tag">{children}</span>,
    Tree,
    Typography: {
      Text: ({ children }: any) => <span>{children}</span>,
      Title: ({ children }: any) => <h3>{children}</h3>,
    },
    message: {
      error: vi.fn(),
      warning: vi.fn(),
    },
  };
});

const textContent = (node: ReactTestInstance): string => node.children.map((child) => (
  typeof child === 'string' ? child : textContent(child)
)).join('');

const findCheckbox = (renderer: ReactTestRenderer, label: string): ReactTestInstance => {
  const checkbox = renderer.root.findAllByProps({ 'data-component': 'checkbox' }).find(
    (candidate) => textContent(candidate).trim() === label,
  );
  if (!checkbox) throw new Error(`Missing checkbox: ${label}`);
  return checkbox;
};

describe('DatabaseSchemaVisibilityModal', () => {
  it('allows selecting one schema directly after clearing every database', async () => {
    const onSave = vi.fn();
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <DatabaseSchemaVisibilityModal
          open
          connectionName="SQL Server"
          source={{}}
          initialDatabase="app"
          primaryLabel="database"
          supportsSchemas
          databaseCaseSensitive={false}
          schemaCaseSensitive={false}
          loadDatabases={async () => ['app', 'audit']}
          loadSchemas={async () => ({
            supported: true,
            schemas: ['dbo', 'reporting'],
          })}
          onCancel={vi.fn()}
          onSave={onSave}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const clearButton = renderer.root.findAllByType('button').find(
      (button) => textContent(button) === 'sidebar.database_schema_visibility.action.clear',
    );
    expect(clearButton).toBeDefined();

    await act(async () => {
      clearButton!.props.onClick();
    });

    expect(findCheckbox(renderer, 'dbo').props.disabled).not.toBe(true);
    expect(findCheckbox(renderer, 'dbo').props.checked).toBe(false);
    expect(findCheckbox(renderer, 'reporting').props.checked).toBe(false);

    await act(async () => {
      findCheckbox(renderer, 'dbo').props.onChange({ target: { checked: true } });
    });

    expect(findCheckbox(renderer, 'app').props.indeterminate).toBe(true);
    expect(findCheckbox(renderer, 'dbo').props.checked).toBe(true);
    expect(findCheckbox(renderer, 'reporting').props.checked).toBe(false);

    await act(async () => {
      await renderer.root.findByProps({ 'data-component': 'modal' }).props.onOk();
    });

    expect(onSave).toHaveBeenCalledWith({
      includeDatabases: ['app'],
      includeDatabasePatterns: [],
      excludeDatabasePatterns: [],
      schemaVisibilityByDatabase: {
        app: { mode: 'include', schemas: ['dbo'] },
      },
    });
  });

  it('starts a lazily loaded database from the schema clicked after clearing', async () => {
    const onSave = vi.fn();
    const loadSchemas = vi.fn(async () => ({
      supported: true,
      schemas: ['dbo', 'reporting'],
    }));
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <DatabaseSchemaVisibilityModal
          open
          connectionName="SQL Server"
          source={{}}
          primaryLabel="database"
          supportsSchemas
          databaseCaseSensitive={false}
          schemaCaseSensitive={false}
          loadDatabases={async () => ['app', 'audit']}
          loadSchemas={loadSchemas}
          onCancel={vi.fn()}
          onSave={onSave}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const clearButton = renderer.root.findAllByType('button').find(
      (button) => textContent(button) === 'sidebar.database_schema_visibility.action.clear',
    );
    await act(async () => {
      clearButton!.props.onClick();
      renderer.root.findByProps({ 'data-component': 'tree' }).props.onExpand(
        ['database:app'],
        { expanded: true, node: { key: 'database:app' } },
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadSchemas).toHaveBeenCalledWith('app');
    expect(findCheckbox(renderer, 'dbo').props.checked).toBe(false);
    expect(findCheckbox(renderer, 'reporting').props.checked).toBe(false);

    await act(async () => {
      findCheckbox(renderer, 'reporting').props.onChange({ target: { checked: true } });
    });

    await act(async () => {
      await renderer.root.findByProps({ 'data-component': 'modal' }).props.onOk();
    });

    expect(onSave).toHaveBeenCalledWith({
      includeDatabases: ['app'],
      includeDatabasePatterns: [],
      excludeDatabasePatterns: [],
      schemaVisibilityByDatabase: {
        app: { mode: 'include', schemas: ['reporting'] },
      },
    });
  });
  it('keeps an in-flight schema load alive when the database list is refreshed', async () => {
    // 刷新库列表只应作废库列表请求。此前它与 schema 加载共用同一个代际计数器，
    // 点一次「刷新」就会丢弃在途 schema 结果，而丢弃分支不落终态，快照永久停在
    // loading：该库一直转圈，且 `!force && status === 'loading'` 守卫挡住后续重试。
    let resolveSchemas!: (value: { supported: boolean; schemas: string[] }) => void;
    const loadSchemas = vi.fn(() => new Promise<{ supported: boolean; schemas: string[] }>((resolve) => {
      resolveSchemas = resolve;
    }));
    let renderer!: ReactTestRenderer;

    await act(async () => {
      renderer = create(
        <DatabaseSchemaVisibilityModal
          open
          connectionName="IRIS"
          source={{}}
          initialDatabase="app"
          primaryLabel="namespace"
          supportsSchemas
          databaseCaseSensitive={false}
          schemaCaseSensitive={false}
          loadDatabases={async () => ['app', 'audit']}
          loadSchemas={loadSchemas}
          onCancel={vi.fn()}
          onSave={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadSchemas).toHaveBeenCalledWith('app');

    const refreshButton = renderer.root.findAllByType('button').find(
      (button) => textContent(button) === 'common.refresh',
    );
    expect(refreshButton).toBeDefined();

    await act(async () => {
      refreshButton!.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      resolveSchemas({ supported: true, schemas: ['dbo', 'reporting'] });
      await Promise.resolve();
      await Promise.resolve();
    });

    // 在途结果不能被刷新作废：schema 必须渲染出来，不能永远停在转圈。
    expect(findCheckbox(renderer, 'dbo')).toBeDefined();
    expect(findCheckbox(renderer, 'reporting')).toBeDefined();
  });
});
