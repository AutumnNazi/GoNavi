import { describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n';
import { buildSidebarNodeMenuItems } from './sidebarNodeMenu';

describe('Oracle database link sidebar menu', () => {
  it('offers view definition and copy name, without mutation actions', () => {
    const handleCopyTableName = vi.fn();
    const onDoubleClick = vi.fn();
    const node = {
      type: 'database-link',
      title: 'ORCL.WORLD',
      dataRef: {
        config: { type: 'oracle' },
        databaseLinkName: 'ORCL.WORLD',
        schemaName: 'SCOTT',
      },
    };

    const items = buildSidebarNodeMenuItems(node, { handleCopyTableName, onDoubleClick }) as any[];
    expect(items.map((item) => item.key)).toEqual(['view-database-link-def', 'copy-database-link-name']);
    expect(items[0].label).toBe(t('sidebar.menu.view_object_definition'));
    expect(items[1].label).toBe(t('sidebar.menu.copy_object_name'));
    items[0].onClick();
    expect(onDoubleClick).toHaveBeenCalledWith(null, node);
    items[1].onClick();
    expect(handleCopyTableName).toHaveBeenCalledWith(node);
  });
});
