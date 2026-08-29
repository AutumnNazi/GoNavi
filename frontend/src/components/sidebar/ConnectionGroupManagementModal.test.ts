import { describe, expect, it } from 'vitest';
import {
  canReorderConnections,
  hasConnectionDragPayload,
  orderConnectionGroupIds,
} from './ConnectionGroupManagementModal';

describe('orderConnectionGroupIds', () => {
  const tags = [
    { id: 'zebra', name: 'Zebra', createdAt: 20, connectionIds: [] },
    { id: 'alpha', name: 'Alpha', createdAt: 10, connectionIds: [] },
    { id: 'newest', name: 'Newest', createdAt: 30, connectionIds: [] },
  ];

  it('uses the persisted token order for manual mode and sorts automatically otherwise', () => {
    const persistedOrder = ['zebra', 'newest', 'alpha'];

    expect(orderConnectionGroupIds(persistedOrder, tags, 'manual')).toEqual(persistedOrder);
    expect(orderConnectionGroupIds(persistedOrder, tags, 'name')).toEqual(['alpha', 'newest', 'zebra']);
    expect(orderConnectionGroupIds(persistedOrder, tags, 'createdAt')).toEqual(['newest', 'zebra', 'alpha']);
  });

  it('allows connection reordering only in custom mode', () => {
    expect(canReorderConnections('manual')).toBe(true);
    expect(canReorderConnections('name')).toBe(false);
    expect(canReorderConnections('createdAt')).toBe(false);
  });

  it('recognizes only connection drags, keeping group tree drops isolated', () => {
    expect(hasConnectionDragPayload({ dataTransfer: { types: ['application/x-gonavi-connection-ids'] } } as any)).toBe(true);
    expect(hasConnectionDragPayload({ dataTransfer: { types: ['text/plain'] } } as any)).toBe(false);
  });
});
