import { describe, expect, it } from 'vitest';

import { sanitizeSidebarTreeOrders, updateSidebarTreeOrders } from './sidebarTreeOrder';

describe('sidebar tree order state', () => {
  it('sanitizes duplicate and invalid persisted keys', () => {
    expect(sanitizeSidebarTreeOrders({
      parent: ['second', 'first', 'second', '', 42],
      empty: [],
      invalid: 'not-an-array',
    })).toEqual({
      parent: ['second', 'first'],
    });
  });

  it('updates and removes parent orders immutably', () => {
    const current = { first: ['a', 'b'], second: ['c'] };
    expect(updateSidebarTreeOrders(current, { first: ['b', 'a'], second: null })).toEqual({
      first: ['b', 'a'],
    });
    expect(current).toEqual({ first: ['a', 'b'], second: ['c'] });
  });
});
