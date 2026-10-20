// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { expect, it, vi } from 'vitest';
import { Input, Tree } from 'antd';
import { LivePreviewSidebar } from './LivePreviewSidebar';

vi.mock('antd', () => ({
  Input: React.forwardRef(() => <input />),
  Tree: () => <div />,
}));

it('reveals the active table even when a search or collapsed tree hid it', () => {
  const onSelect = vi.fn();
  const props = { mode: 'classic' as const, table: 'orders', connectionName: 'Demo', searchFocus: 0, revealTable: 0, onSelect };
  let view!: ReturnType<typeof create>;
  act(() => { view = create(<LivePreviewSidebar {...props} />); });
  act(() => view.root.findByType(Input).props.onChange({ target: { value: 'customers' } }));
  act(() => view.root.findByType(Tree).props.onExpand([]));
  expect(view.root.findByType(Tree).props.expandedKeys).toEqual([]);
  expect(view.root.findByType(Input).props.value).toBe('customers');
  act(() => view.update(<LivePreviewSidebar {...props} revealTable={1} />));
  expect(view.root.findByType(Input).props.value).toBe('');
  expect(view.root.findByType(Tree).props.expandedKeys).toEqual(['connection', 'database', 'tables']);
  expect(view.root.findByType(Tree).props.selectedKeys).toEqual(['orders']);
  expect(onSelect).not.toHaveBeenCalled();
  act(() => view.unmount());
});
