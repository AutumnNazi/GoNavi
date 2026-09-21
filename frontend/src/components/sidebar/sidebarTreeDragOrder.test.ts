import { describe, expect, it } from 'vitest';

import { SIDEBAR_SQL_EDITOR_DRAG_MIME } from '../../utils/sidebarSqlDrag';
import type { SidebarTreeNode } from '../sidebarV2Utils';
import {
  applySidebarTreeOrders,
  canDropSidebarTreeOrderNode,
  markSidebarTreeMouseDownHandled,
  resolveSidebarHostTreeDropAtEvent,
  resolveSidebarHostTreeGapTarget,
  resolveSidebarTreeOrderDrop,
  resolveSidebarTreeOrderDropAtEvent,
  setSidebarTreeSqlDragData,
} from './sidebarTreeDragOrder';

const databaseNode = (connectionId: string, dbName: string): SidebarTreeNode => ({
  key: `${connectionId}-${dbName}`,
  title: dbName,
  type: 'database',
  dataRef: { id: connectionId, dbName },
});

const tableNode = (
  connectionId: string,
  dbName: string,
  schemaName: string,
  tableName: string,
  pinned = false,
): SidebarTreeNode => ({
  key: `${connectionId}-${dbName}-${schemaName}-${tableName}`,
  title: tableName,
  type: 'table',
  dataRef: {
    id: connectionId,
    dbName,
    schemaName,
    tableName,
    ...(pinned ? { pinnedSidebarTable: true } : {}),
  },
});

const objectNode = (
  type: SidebarTreeNode['type'],
  key: string,
  title: string,
): SidebarTreeNode => ({
  key,
  title,
  type,
  dataRef: { id: 'conn-1', dbName: 'main' },
  isLeaf: true,
});

const withSidebarTreeRowHit = <T>(
  node: SidebarTreeNode,
  run: (target: EventTarget) => T,
): T => {
  const row = {
    getAttribute: (name: string) => name === 'data-sidebar-node-key'
      ? node.key
      : name === 'data-sidebar-node-type'
        ? node.type
        : null,
    querySelector: () => null,
    getBoundingClientRect: () => ({ top: 100, height: 20 }),
  };
  const target = {
    closest: (selector: string) => selector === '.ant-tree-treenode' ? row : null,
  } as unknown as EventTarget;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { elementFromPoint: () => target },
  });
  try {
    return run(target);
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  }
};

describe('sidebar tree drag order', () => {
  it('reorders databases only inside the same connection', () => {
    const first = databaseNode('conn-1', 'first');
    const second = databaseNode('conn-1', 'second');
    const other = databaseNode('conn-2', 'other');
    const tree: SidebarTreeNode[] = [
      { key: 'conn-1', title: 'one', type: 'connection', children: [first, second] },
      { key: 'conn-2', title: 'two', type: 'connection', children: [other] },
    ];

    expect(canDropSidebarTreeOrderNode(tree, second, first, -1)).toBe(true);
    expect(canDropSidebarTreeOrderNode(tree, second, other, -1)).toBe(false);

    const result = resolveSidebarTreeOrderDrop(tree, second, first, true);
    expect(result?.parentKey).toBe('conn-1');
    expect(result?.orderedKeys).toEqual([second.key, first.key]);
    expect(result?.treeData[0].children?.map((node) => node.key)).toEqual([second.key, first.key]);
    expect(result?.treeData[1]).toBe(tree[1]);
  });

  it('reorders tables inside one schema group without crossing pin sections', () => {
    const pinned = tableNode('conn-1', 'main', 'public', 'pinned', true);
    const users = tableNode('conn-1', 'main', 'public', 'users');
    const orders = tableNode('conn-1', 'main', 'public', 'orders');
    const otherSchema = tableNode('conn-1', 'main', 'audit', 'events');
    const publicGroup: SidebarTreeNode = {
      key: 'conn-1-main-public-tables',
      title: 'tables',
      type: 'object-group',
      children: [
        { key: 'pinned-section', title: 'pinned', type: 'v2-table-section' },
        pinned,
        { key: 'all-section', title: 'all', type: 'v2-table-section' },
        users,
        orders,
      ],
    };
    const auditGroup: SidebarTreeNode = {
      key: 'conn-1-main-audit-tables',
      title: 'tables',
      type: 'object-group',
      children: [otherSchema],
    };
    const tree: SidebarTreeNode[] = [{
      key: 'conn-1',
      title: 'connection',
      type: 'connection',
      children: [{
        key: 'conn-1-main',
        title: 'main',
        type: 'database',
        children: [publicGroup, auditGroup],
      }],
    }];

    expect(canDropSidebarTreeOrderNode(tree, orders, users, -1)).toBe(true);
    expect(canDropSidebarTreeOrderNode(tree, pinned, users, -1)).toBe(false);
    expect(canDropSidebarTreeOrderNode(tree, users, otherSchema, -1)).toBe(false);

    const result = resolveSidebarTreeOrderDrop(tree, orders, users, true);
    expect(result?.parentKey).toBe(publicGroup.key);
    expect(result?.orderedKeys).toEqual([pinned.key, orders.key, users.key]);
    expect(result?.treeData[0].children?.[0].children?.[0].children?.map((node) => node.key)).toEqual([
      'pinned-section',
      pinned.key,
      'all-section',
      orders.key,
      users.key,
    ]);

    const movedDown = resolveSidebarTreeOrderDrop(tree, users, orders, false);
    expect(movedDown?.treeData[0].children?.[0].children?.[0].children?.map((node) => node.key)).toEqual([
      'pinned-section',
      pinned.key,
      'all-section',
      orders.key,
      users.key,
    ]);
  });

  it('uses the real first row upper half as a before target', () => {
    const first = tableNode('conn-1', 'main', 'public', 'first');
    const second = tableNode('conn-1', 'main', 'public', 'second');
    const tree: SidebarTreeNode[] = [{
      key: 'tables',
      title: 'tables',
      type: 'object-group',
      children: [first, second],
    }];
    const row = {
      getAttribute: (name: string) => name === 'data-sidebar-node-key'
        ? first.key
        : name === 'data-sidebar-node-type'
          ? first.type
          : null,
      querySelector: () => null,
      getBoundingClientRect: () => ({ top: 100, height: 20 }),
    };
    const target = { closest: (selector: string) => selector === '.ant-tree-treenode' ? row : null };
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { elementFromPoint: () => target },
    });
    try {
      const result = resolveSidebarTreeOrderDropAtEvent(tree, second, {
        clientX: 10,
        clientY: 105,
        target: target as unknown as EventTarget,
      });
      expect(result?.dropNode).toBe(first);
      expect(result?.placement).toBe('before');
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('represents a non-first row upper edge as the previous row lower edge', () => {
    const first = tableNode('conn-1', 'main', 'public', 'first');
    const second = tableNode('conn-1', 'main', 'public', 'second');
    const third = tableNode('conn-1', 'main', 'public', 'third');
    const tree: SidebarTreeNode[] = [{
      key: 'tables',
      title: 'tables',
      type: 'object-group',
      children: [first, second, third],
    }];
    const row = {
      getAttribute: (name: string) => name === 'data-sidebar-node-key'
        ? third.key
        : name === 'data-sidebar-node-type'
          ? third.type
          : null,
      querySelector: () => null,
      getBoundingClientRect: () => ({ top: 120, height: 20 }),
    };
    const target = { closest: (selector: string) => selector === '.ant-tree-treenode' ? row : null };
    const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { elementFromPoint: () => target },
    });
    try {
      const result = resolveSidebarTreeOrderDropAtEvent(tree, first, {
        clientX: 10,
        clientY: 125,
        target: target as unknown as EventTarget,
      });
      expect(result?.dropNode).toBe(second);
      expect(result?.hit.key).toBe(second.key);
      expect(result?.placement).toBe('after');
    } finally {
      if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
      else Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('represents a non-first Host group upper edge as the previous sibling lower edge', () => {
    const first: SidebarTreeNode = {
      key: 'tag-first', title: 'first', type: 'tag', dataRef: { id: 'first' },
    };
    const second: SidebarTreeNode = {
      key: 'tag-second', title: 'second', type: 'tag', dataRef: { id: 'second' },
    };
    const third: SidebarTreeNode = {
      key: 'tag-third', title: 'third', type: 'tag', dataRef: { id: 'third' },
    };
    const tree = [first, second, third];

    expect(resolveSidebarHostTreeGapTarget(tree, third, 'before')).toEqual({
      dropNode: second,
      placement: 'after',
    });
    expect(resolveSidebarHostTreeGapTarget(tree, first, 'before')).toEqual({
      dropNode: first,
      placement: 'before',
    });
  });

  it('does not show an order drop line on either edge of the dragged object row', () => {
    const first = tableNode('conn-1', 'main', 'public', 'first');
    const second = tableNode('conn-1', 'main', 'public', 'second');
    const third = tableNode('conn-1', 'main', 'public', 'third');
    const tree: SidebarTreeNode[] = [{
      key: 'tables',
      title: 'tables',
      type: 'object-group',
      children: [first, second, third],
    }];

    const noOp = withSidebarTreeRowHit(first, (target) => (
      resolveSidebarTreeOrderDropAtEvent(tree, second, {
        clientX: 10,
        clientY: 115,
        target,
      })
    ));
    expect(noOp).toBeNull();

    const ownLowerEdge = withSidebarTreeRowHit(second, (target) => (
      resolveSidebarTreeOrderDropAtEvent(tree, second, {
        clientX: 10,
        clientY: 119,
        target,
      })
    ));
    expect(ownLowerEdge).toBeNull();

    const actualMove = withSidebarTreeRowHit(first, (target) => (
      resolveSidebarTreeOrderDropAtEvent(tree, third, {
        clientX: 10,
        clientY: 115,
        target,
      })
    ));
    expect(actualMove?.dropNode).toBe(first);
    expect(actualMove?.placement).toBe('after');
  });

  it('does not show a Host drop line on either edge of the dragged group row', () => {
    const first: SidebarTreeNode = {
      key: 'tag-first', title: 'first', type: 'tag', dataRef: { id: 'first' },
    };
    const second: SidebarTreeNode = {
      key: 'tag-second', title: 'second', type: 'tag', dataRef: { id: 'second' },
    };
    const third: SidebarTreeNode = {
      key: 'tag-third', title: 'third', type: 'tag', dataRef: { id: 'third' },
    };
    const tree = [first, second, third];

    const noOp = withSidebarTreeRowHit(first, (target) => (
      resolveSidebarHostTreeDropAtEvent(tree, second, {
        clientX: 10,
        clientY: 119,
        target,
      })
    ));
    expect(noOp).toBeNull();

    const ownLowerEdge = withSidebarTreeRowHit(second, (target) => (
      resolveSidebarHostTreeDropAtEvent(tree, second, {
        clientX: 10,
        clientY: 119,
        target,
      })
    ));
    expect(ownLowerEdge).toBeNull();

    const actualMove = withSidebarTreeRowHit(first, (target) => (
      resolveSidebarHostTreeDropAtEvent(tree, third, {
        clientX: 10,
        clientY: 119,
        target,
      })
    ));
    expect(actualMove?.dropNode).toBe(first);
    expect(actualMove?.placement).toBe('after');
  });

  it('reapplies saved order after refresh and appends new nodes stably', () => {
    const first = databaseNode('conn-1', 'first');
    const second = databaseNode('conn-1', 'second');
    const added = databaseNode('conn-1', 'added');
    const ordered = applySidebarTreeOrders('conn-1', [first, second, added], {
      'conn-1': [second.key, first.key],
    }, {});

    expect(ordered.map((node) => node.key)).toEqual([second.key, first.key, added.key]);
    const uncustomized = [first, second, added];
    expect(applySidebarTreeOrders('conn-1', uncustomized, {}, {})).toBe(uncustomized);
  });

  it('only applies saved table order while manual sorting is active', () => {
    const users = tableNode('conn-1', 'main', 'public', 'users');
    const orders = tableNode('conn-1', 'main', 'public', 'orders');
    const parentKey = 'conn-1-main-public-tables';
    const savedOrder = { [parentKey]: [orders.key, users.key] };

    expect(applySidebarTreeOrders(parentKey, [users, orders], savedOrder, {
      'conn-1-main': 'name',
    }).map((node) => node.key)).toEqual([users.key, orders.key]);
    expect(applySidebarTreeOrders(parentKey, [users, orders], savedOrder, {
      'conn-1-main': 'manual',
    }).map((node) => node.key)).toEqual([orders.key, users.key]);
  });

  it.each([
    ['view', 'views'],
    ['materialized-view', 'materialized-views'],
    ['sequence', 'sequences'],
    ['db-trigger', 'triggers'],
    ['routine', 'routines'],
    ['package', 'packages'],
    ['database-link', 'database-links'],
    ['db-event', 'events'],
    ['saved-query', 'queries'],
    ['message-object', 'message-objects'],
  ] as const)('reorders %s nodes inside their own group', (type, groupKey) => {
    const first = objectNode(type, `${groupKey}-first`, 'first');
    const second = objectNode(type, `${groupKey}-second`, 'second');
    const tree: SidebarTreeNode[] = [{
      key: groupKey,
      title: groupKey,
      type: 'object-group',
      children: [first, second],
    }];

    expect(canDropSidebarTreeOrderNode(tree, second, first, -1)).toBe(true);
    expect(resolveSidebarTreeOrderDrop(tree, second, first, true)?.orderedKeys).toEqual([
      second.key,
      first.key,
    ]);
  });

  it('marks draggable rows so virtual-list does not start mouse-drag scrolling', () => {
    const nativeEvent: Event & { _virtualHandled?: boolean } = new Event('mousedown');
    const handled = markSidebarTreeMouseDownHandled({
      nativeEvent,
      target: { closest: () => ({}) } as unknown as EventTarget,
    });

    expect(handled).toBe(true);
    expect(nativeEvent._virtualHandled).toBe(true);
  });

  it('keeps SQL editor drag data on the unified tree drag source', () => {
    const writes = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: 'move',
      setData: (type: string, value: string) => writes.set(type, value),
    } as unknown as DataTransfer;

    expect(setSidebarTreeSqlDragData({ dataTransfer }, tableNode(
      'conn-1',
      'main',
      'public',
      'users',
    ))).toBe(true);
    expect(dataTransfer.effectAllowed).toBe('copyMove');
    expect(writes.get('text/plain')).toBe('users');
    expect(writes.get(SIDEBAR_SQL_EDITOR_DRAG_MIME)).toContain('"text":"users"');
  });
});
