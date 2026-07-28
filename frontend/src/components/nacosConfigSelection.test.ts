import { describe, expect, it, vi } from 'vitest';

import {
  deleteSelectedNacosConfigs,
  nacosConfigSelectionKey,
  reconcileNacosConfigSelection,
  selectedNacosConfigItems,
} from './nacosConfigSelection';

const rows = [
  { dataId: 'app.yaml', group: 'DEFAULT_GROUP' },
  { dataId: 'shared.json', group: 'APP_GROUP' },
  { dataId: 'contains@@separator', group: 'APP_GROUP' },
];

describe('nacos config selection', () => {
  it('builds collision-safe keys for arbitrary data ids and groups', () => {
    expect(nacosConfigSelectionKey(rows[2])).toBe('["APP_GROUP","contains@@separator"]');
    expect(nacosConfigSelectionKey({ dataId: 'separator', group: 'APP_GROUP@@contains' }))
      .not.toBe(nacosConfigSelectionKey(rows[2]));
  });

  it('maps selected keys back to visible rows in list order', () => {
    const selected = selectedNacosConfigItems(rows, [
      nacosConfigSelectionKey(rows[2]),
      nacosConfigSelectionKey(rows[0]),
      '["OTHER","missing"]',
    ]);

    expect(selected).toEqual([rows[0], rows[2]]);
  });

  it('drops selections that are not on the current page', () => {
    expect(reconcileNacosConfigSelection(rows.slice(1), [
      nacosConfigSelectionKey(rows[0]),
      nacosConfigSelectionKey(rows[1]),
    ])).toEqual([nacosConfigSelectionKey(rows[1])]);
  });

  it('deletes sequentially and reports partial failures for retry', async () => {
    let active = 0;
    let maxActive = 0;
    const deleteOne = vi.fn(async (item: (typeof rows)[number]) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return item.dataId === 'shared.json'
        ? { success: false, message: 'permission denied' }
        : { success: true };
    });

    const result = await deleteSelectedNacosConfigs(rows, deleteOne);

    expect(maxActive).toBe(1);
    expect(deleteOne).toHaveBeenCalledTimes(3);
    expect(result.deleted).toEqual([rows[0], rows[2]]);
    expect(result.failed).toEqual([{ item: rows[1], message: 'permission denied' }]);
  });

  it('turns thrown errors into failed items instead of aborting the batch', async () => {
    const result = await deleteSelectedNacosConfigs(rows.slice(0, 2), async (item) => {
      if (item.dataId === 'app.yaml') throw new Error('network timeout');
      return { success: true };
    });

    expect(result.deleted).toEqual([rows[1]]);
    expect(result.failed).toEqual([{ item: rows[0], message: 'network timeout' }]);
  });
});
