import { describe, expect, it, vi } from 'vitest';

import { t } from '../../i18n';
import { openDatabaseLinkDefinition } from './sidebarOpenDatabaseLinkDefinition';

describe('openDatabaseLinkDefinition', () => {
  it('opens a database-link definition tab with the full link name', () => {
    const addTab = vi.fn();
    const node = {
      key: 'conn-ora-H2-databaseLinks-database-link-BJDBUAT',
      dataRef: {
        id: 'conn-ora',
        dbName: 'H2',
        schemaName: 'H2',
        databaseLinkName: 'BJDBUAT',
      },
    };

    openDatabaseLinkDefinition(node, addTab);

    expect(addTab).toHaveBeenCalledWith({
      id: 'database-link-def-conn-ora-H2-H2-BJDBUAT',
      title: t('sidebar.tab.database_link_definition', { name: 'BJDBUAT' }),
      type: 'database-link-def',
      connectionId: 'conn-ora',
      dbName: 'H2',
      databaseLinkName: 'BJDBUAT',
      schemaName: 'H2',
      sidebarLocateKey: node.key,
    });
  });

  it('does not open a tab when the link name is missing', () => {
    const addTab = vi.fn();
    openDatabaseLinkDefinition({ dataRef: { id: 'conn-ora', dbName: 'H2' } }, addTab);
    expect(addTab).not.toHaveBeenCalled();
  });

  it('falls back to the node title when databaseLinkName is missing', () => {
    const addTab = vi.fn();
    openDatabaseLinkDefinition({
      title: 'HYDEEBZB',
      dataRef: { id: 'conn-ora', dbName: 'H2', schemaName: 'H2' },
    }, addTab);
    expect(addTab).toHaveBeenCalledWith(expect.objectContaining({
      databaseLinkName: 'HYDEEBZB',
      type: 'database-link-def',
    }));
  });
});
