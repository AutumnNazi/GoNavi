// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The embedded "fields" (表设计) view builds the designer's `tab` as an inline
// object literal, so its identity changes on every parent render. The designer
// must not re-run its metadata RPCs just because the parent re-rendered.
const columnFetchCalls: number[] = [];

beforeEach(() => {
  columnFetchCalls.length = 0;
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
    return Promise.resolve({ success: true, data: [] });
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
