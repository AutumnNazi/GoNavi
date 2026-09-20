import { describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n';
import { tryOpenSidebarObjectNode } from './sidebarOpenObjectNode';

describe('tryOpenSidebarObjectNode', () => {
  it('opens a database-link definition tab', () => {
    const addTab = vi.fn();
    const opened = tryOpenSidebarObjectNode({
      key: 'conn-ora-H2-databaseLinks-database-link-BJDBUAT',
      type: 'database-link',
      dataRef: {
        id: 'conn-ora',
        dbName: 'H2',
        schemaName: 'H2',
        databaseLinkName: 'BJDBUAT',
      },
    }, {
      addTab,
      openEventDefinition: vi.fn(),
      openSequenceDefinition: vi.fn(),
      openPackageDefinition: vi.fn(),
      t: (key) => key,
      buildOptionalSchemaContext: () => ({}),
    });

    expect(opened).toBe(true);
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      type: 'database-link-def',
      databaseLinkName: 'BJDBUAT',
      title: t('sidebar.tab.database_link_definition', { name: 'BJDBUAT' }),
    }));
  });
});
