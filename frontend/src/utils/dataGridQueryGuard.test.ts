import { afterEach, describe, expect, it, vi } from 'vitest';
import { message } from 'antd';
import { allowDataGridQueryChange } from './dataGridQueryGuard';
import { registerWorkbenchTabCloseGuard } from './workbenchTabCloseProtection';

vi.mock('antd', () => ({ message: { warning: vi.fn() } }));

describe('allowDataGridQueryChange', () => {
  afterEach(() => vi.clearAllMocks());

  it('blocks only the grid owning pending changes and leaves them untouched', () => {
    const guard = {
      isDirty: () => true,
      save: vi.fn(async () => true),
      discard: vi.fn(),
    };
    const unregister = registerWorkbenchTabCloseGuard('pending-data-grid', guard);
    try {
      expect(allowDataGridQueryChange(undefined, (key) => key)).toBe(true);
      expect(allowDataGridQueryChange('other-data-grid', (key) => key)).toBe(true);
      expect(message.warning).not.toHaveBeenCalled();

      expect(allowDataGridQueryChange('pending-data-grid', (key) => key)).toBe(false);
      expect(message.warning).toHaveBeenCalledWith({
        content: 'data_grid.message.query_change_with_pending_edits',
        key: 'gonavi:data-grid-pending-query',
      });
      expect(guard.save).not.toHaveBeenCalled();
      expect(guard.discard).not.toHaveBeenCalled();
    } finally {
      unregister();
    }
  });

  it('allows a query after the registered grid clears its changes', () => {
    let hasChanges = true;
    const unregister = registerWorkbenchTabCloseGuard('saved-data-grid', {
      isDirty: () => hasChanges,
      save: async () => true,
      discard: () => undefined,
    });
    try {
      expect(allowDataGridQueryChange('saved-data-grid', (key) => key)).toBe(false);
      hasChanges = false;
      expect(allowDataGridQueryChange('saved-data-grid', (key) => key)).toBe(true);
      expect(message.warning).toHaveBeenCalledOnce();
    } finally {
      unregister();
    }
  });
});
