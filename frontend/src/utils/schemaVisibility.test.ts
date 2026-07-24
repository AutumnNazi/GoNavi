import { describe, expect, it } from 'vitest';

import type { SavedConnection } from '../types';
import {
  getSchemaVisibilityRule,
  isSchemaVisible,
  moveSchemaVisibilityRule,
  updateSchemaVisibilityRule,
} from './schemaVisibility';

const connection = (rules?: SavedConnection['schemaVisibilityByDatabase']): SavedConnection => ({
  id: 'conn-1',
  name: 'Primary',
  config: {
    id: 'conn-1',
    type: 'sqlserver',
    host: 'localhost',
    port: 1433,
    user: 'sa',
  },
  schemaVisibilityByDatabase: rules,
});

describe('schema visibility', () => {
  it('looks up per-database rules without changing identifier case semantics', () => {
    const rule = getSchemaVisibilityRule(connection({
      ecology: { mode: 'include', schemas: ['dbo'] },
    }), 'ECOLOGY');

    expect(rule).toEqual({ mode: 'include', schemas: ['dbo'] });
    expect(isSchemaVisible(rule, 'dbo')).toBe(true);
    expect(isSchemaVisible(rule, 'DBO')).toBe(true);
    expect(isSchemaVisible(rule, 'guest')).toBe(false);
  });

  it('hides only configured schemas in exclude mode', () => {
    const rule = getSchemaVisibilityRule(connection({
      ecology: { mode: 'exclude', schemas: ['db_accessadmin', 'guest'] },
    }), 'ecology');

    expect(isSchemaVisible(rule, 'dbo')).toBe(true);
    expect(isSchemaVisible(rule, 'GUEST')).toBe(false);
    expect(isSchemaVisible(undefined, 'dbo')).toBe(true);
  });

  it('writes one database rule and removes it when reset to show all', () => {
    const initial = connection({
      master: { mode: 'exclude', schemas: ['sys'] },
    });
    const updated = updateSchemaVisibilityRule(initial, 'ecology', {
      mode: 'include',
      schemas: ['dbo'],
    });

    expect(updated.schemaVisibilityByDatabase).toEqual({
      master: { mode: 'exclude', schemas: ['sys'] },
      ecology: { mode: 'include', schemas: ['dbo'] },
    });
    expect(updateSchemaVisibilityRule(updated, 'ECOLOGY', undefined).schemaVisibilityByDatabase).toEqual({
      master: { mode: 'exclude', schemas: ['sys'] },
    });
  });

  it('moves an existing rule when its database is renamed', () => {
    const moved = moveSchemaVisibilityRule(connection({
      ecology: { mode: 'exclude', schemas: ['db_accessadmin'] },
    }), 'ECOLOGY', 'ecology_prod');

    expect(moved.schemaVisibilityByDatabase).toEqual({
      ecology_prod: { mode: 'exclude', schemas: ['db_accessadmin'] },
    });
  });
});
