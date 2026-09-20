import { describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n';
import { buildSidebarNodeMenuItems } from './sidebarNodeMenu';

describe('Oracle database link sidebar menu', () => {
  it('offers copy name and no definition or mutation actions', () => {
    const handleCopyTableName = vi.fn();
    const node = {
      type: 'database-link',
      title: 'ORCL.WORLD',
      dataRef: {
        config: { type: 'oracle' },
        databaseLinkName: 'ORCL.WORLD',
        schemaName: 'SCOTT',
      },
    };

    const items = buildSidebarNodeMenuItems(node, { handleCopyTableName }) as any[];
    expect(items).toHaveLength(1);
    expect(items[0].key).toBe('copy-database-link-name');
    expect(items[0].label).toBe(t('sidebar.menu.copy_object_name'));
    items[0].onClick();
    expect(handleCopyTableName).toHaveBeenCalledWith(node);
  });
});
