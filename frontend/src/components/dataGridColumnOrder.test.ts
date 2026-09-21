import { describe, expect, it } from 'vitest';
import React from 'react';
import { act, create } from 'react-test-renderer';

import {
  DATA_GRID_COLUMN_ORDER_DRAG_MIME,
  decodeDataGridColumnOrderDragPayload,
  encodeDataGridColumnOrderDragPayload,
  hasDataGridColumnOrderDragPayload,
  moveDataGridColumnInVisibleOrder,
  resolveDataGridDisplayColumnNames,
  shouldBypassDndKitForNativeColumnHeaderDrag,
  useDataGridColumnLayout,
} from './dataGridColumnOrder';

describe('dataGridColumnOrder helpers', () => {
  it('resets unsaved layout when switching tables with the same columns', () => {
    const columns = ['id', 'name'];
    let current: ReturnType<typeof useDataGridColumnLayout>;
    const Harness = ({ table }: { table: string }) => {
      current = useDataGridColumnLayout(columns, undefined, undefined, table);
      return null;
    };
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(Harness, { table: 'first' })); });
    try {
      act(() => {
        current.setAllOrderedColumnNames(['name', 'id']);
        current.setLocalHiddenColumns(['name']);
      });
      act(() => tree.update(React.createElement(Harness, { table: 'first' })));
      expect(current!.allOrderedColumnNames).toEqual(['name', 'id']);
      expect(current!.localHiddenColumns).toEqual(['name']);
      act(() => tree.update(React.createElement(Harness, { table: 'second' })));
      expect(current!.allOrderedColumnNames).toEqual(['id', 'name']);
      expect(current!.localHiddenColumns).toEqual([]);
    } finally { act(() => tree.unmount()); }
  });
  it('starts with the saved layout without an extra commit, and tracks changed columns', () => {
    let current: ReturnType<typeof useDataGridColumnLayout>;
    const snapshots: Array<{ order: string[]; hidden: string[] }> = [];
    const storedOrder = ['name', 'id', 'removed'];
    const storedHidden = ['note'];
    const columns = ['id', 'name', 'note'];
    const Harness = ({ columns }: { columns: string[] }) => {
      current = useDataGridColumnLayout(columns, storedOrder, storedHidden);
      snapshots.push({ order: current.allOrderedColumnNames, hidden: current.localHiddenColumns });
      return null;
    };
    let tree: ReturnType<typeof create>;
    act(() => { tree = create(React.createElement(Harness, { columns })); });
    try {
      expect(snapshots[0]).toEqual({ order: ['name', 'id', 'note'], hidden: ['note'] });
      expect(snapshots).toHaveLength(1);
      act(() => current.setAllOrderedColumnNames(['note', 'id', 'name']));
      act(() => tree.update(React.createElement(Harness, { columns })));
      expect(current!.allOrderedColumnNames).toEqual(['note', 'id', 'name']);
      act(() => tree.update(React.createElement(Harness, { columns: ['id', 'name', 'added'] })));
      expect(current!.allOrderedColumnNames).toEqual(['name', 'id', 'added']);
    } finally { act(() => tree.unmount()); }
  });
  it('reorders a dragged visible column at the header drop target while hidden columns keep their slot', () => {
    expect(moveDataGridColumnInVisibleOrder(
      ['id', 'hidden_note', 'name', 'code'],
      new Set(['hidden_note']),
      'code',
      'id',
    )).toEqual(['code', 'hidden_note', 'id', 'name']);
  });

  it('keeps the column reorder payload scoped to its source result set', () => {
    const payload = encodeDataGridColumnOrderDragPayload({
      scope: 'result-set-1',
      columnName: 'title',
    });

    expect(decodeDataGridColumnOrderDragPayload(payload)).toEqual({
      scope: 'result-set-1',
      columnName: 'title',
    });
    expect(hasDataGridColumnOrderDragPayload({
      types: [DATA_GRID_COLUMN_ORDER_DRAG_MIME],
    })).toBe(true);
    expect(decodeDataGridColumnOrderDragPayload('{')).toBeNull();
  });

  it('keeps touch and pen pointer input on dnd-kit instead of native HTML drag', () => {
    expect(shouldBypassDndKitForNativeColumnHeaderDrag('mouse')).toBe(true);
    expect(shouldBypassDndKitForNativeColumnHeaderDrag('touch')).toBe(false);
    expect(shouldBypassDndKitForNativeColumnHeaderDrag('pen')).toBe(false);
  });

  it('uses incoming columns immediately while a previous ordered snapshot is stale', () => {
    expect(resolveDataGridDisplayColumnNames({
      visibleColumnNames: ['id', 'name', 'status'],
      orderedColumnNames: [],
      hiddenColumnNames: new Set(),
      pinnedLeftColumnNames: ['status'],
    })).toEqual(['status', 'id', 'name']);

    expect(resolveDataGridDisplayColumnNames({
      visibleColumnNames: ['id', 'name'],
      orderedColumnNames: ['legacy_id'],
      hiddenColumnNames: new Set(),
      pinnedLeftColumnNames: [],
    })).toEqual(['id', 'name']);
  });

  it('keeps a current manual order while applying hidden and pinned columns', () => {
    expect(resolveDataGridDisplayColumnNames({
      visibleColumnNames: ['id', 'name', 'status', 'note'],
      orderedColumnNames: ['name', 'id', 'note', 'status'],
      hiddenColumnNames: new Set(['note']),
      pinnedLeftColumnNames: ['status'],
    })).toEqual(['status', 'name', 'id']);
  });
});
