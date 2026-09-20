import { describe, expect, it } from 'vitest';

import { t } from '../../i18n';
import { resolveCopyObjectNameLabel } from './sidebarCopyObjectName';

describe('resolveCopyObjectNameLabel', () => {
  it('uses a dedicated label for database links', () => {
    expect(resolveCopyObjectNameLabel({ type: 'database-link' })).toBe(
      t('sidebar.copy_object_name.label.database_link'),
    );
  });

  it('keeps existing object labels', () => {
    expect(resolveCopyObjectNameLabel({ type: 'sequence' })).toBe(t('sidebar.copy_object_name.label.sequence'));
    expect(resolveCopyObjectNameLabel({ type: 'package' })).toBe(t('sidebar.copy_object_name.label.package'));
    expect(resolveCopyObjectNameLabel({ type: 'table' })).toBe(t('sidebar.copy_object_name.label.table'));
  });
});
