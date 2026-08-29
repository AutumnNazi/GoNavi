import { describe, expect, it } from 'vitest';
import { orderConnectionGroupIds } from './ConnectionGroupManagementModal';

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
});
