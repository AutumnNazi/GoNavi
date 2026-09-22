// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The embedded "fields" (表设计) view builds the designer's `tab` as an inline
// object literal, so its identity changes on every parent render. The designer
// must not re-run its metadata RPCs just because the parent re-rendered.
const columnFetchCalls: number[] = [];
let columnFixture: Array<Record<string, unknown>> = [];

beforeEach(() => {
  columnFetchCalls.length = 0;
  columnFixture = [];
});

beforeAll(() => {
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (window as any).matchMedia = (window as any).matchMedia || (() => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});

vi.mock('../../wailsjs/go/app/App', () => ({
  DBGetColumns: vi.fn(() => {
    columnFetchCalls.push(1);
    return Promise.resolve({ success: true, data: columnFixture });
  }),
  DBGetIndexes: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  DBGetForeignKeys: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  DBGetTriggers: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  DBShowCreateTable: vi.fn(() => Promise.resolve({ success: true, data: '' })),
  DBQuery: vi.fn(() => Promise.resolve({ success: true, data: [] })),
  DBQueryAudited: vi.fn(() => Promise.resolve({ success: true, data: [] })),
}));

vi.mock('./MonacoEditor', () => ({ default: () => null }));

vi.mock('../store', async () => {
  const actual = await vi.importActual<any>('../store');
  const state = {
    connections: [{
      id: 'conn-1',
      name: 'test',
      config: { type: 'mysql', host: 'h', port: 3306, user: 'u', password: '', database: 'demo' },
    }],
    addTab: () => undefined,
    setActiveContext: () => undefined,
    tableDesignerSchemaByConnection: {},
    setTableDesignerSchema: () => undefined,
    theme: 'light',
    appearance: {},
  };
  return { ...actual, useStore: (selector: any) => selector(state) };
});

const flush = async () => {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
};

const buildEmbeddedTab = (tableName: string) => ({
  id: `embedded-design-conn-1-demo-${tableName}`,
  title: tableName,
  type: 'design' as const,
  connectionId: 'conn-1',
  dbName: 'demo',
  tableName,
  initialTab: 'columns',
  readOnly: true,
  objectType: 'table' as const,
});

describe('TableDesigner metadata fetch lifetime', () => {
  it('keeps a renamed field editable across parent rerenders', async () => {
    const { default: TableDesigner } = await import('./TableDesigner');
    const { Simulate } = await import('react-dom/test-utils');
    columnFixture = [{ name: 'old_name', type: 'varchar(64)', nullable: 'YES', key: '', extra: '' }];
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const tab = { ...buildEmbeddedTab('users'), readOnly: false };
    try {
      await act(async () => root.render(<TableDesigner embedded tab={tab} />));
      await flush();
      const input = host.querySelector<HTMLInputElement>('.ant-table-tbody .table-designer-cell-field input')!;
      expect(input.value).toBe('old_name');
      expect(host.querySelector('.table-designer-comment-field button')).toBeNull();
      expect(host.querySelector('.table-designer-action-cell [aria-label="edit"]')).not.toBeNull();
      await act(async () => { Simulate.change(input, { target: { value: 'new_name' } } as never); });
      expect(input.value).toBe('new_name');
      await act(async () => root.render(<TableDesigner embedded tab={{ ...tab }} />));
      expect(host.querySelector<HTMLInputElement>('.ant-table-tbody .table-designer-cell-field input')?.value).toBe('new_name');
    } finally { await act(async () => root.unmount()); host.remove(); }
  }, 60000);
  it('does not refetch when only the parent re-renders with a new tab identity', async () => {
    const { default: TableDesigner } = await import('./TableDesigner');
    const Host = ({ tick }: { tick: number }) => (
      <TableDesigner embedded tab={buildEmbeddedTab('users')} />
    );

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => { root.render(<Host tick={0} />); });
    await flush();
    const afterMount = columnFetchCalls.length;
    expect(afterMount).toBeGreaterThan(0);

    for (let tick = 1; tick <= 3; tick += 1) {
      await act(async () => { root.render(<Host tick={tick} />); });
      await flush();
    }
    expect(columnFetchCalls.length).toBe(afterMount);

    await act(async () => { root.unmount(); });
    container.remove();
  }, 20000);

  it('refetches when the target table actually changes', async () => {
    const { default: TableDesigner } = await import('./TableDesigner');

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<TableDesigner embedded tab={buildEmbeddedTab('users')} />);
    });
    await flush();
    const afterMount = columnFetchCalls.length;

    await act(async () => {
      root.render(<TableDesigner embedded tab={buildEmbeddedTab('orders')} />);
    });
    await flush();
    expect(columnFetchCalls.length).toBeGreaterThan(afterMount);

    await act(async () => { root.unmount(); });
    container.remove();
  }, 20000);
});
