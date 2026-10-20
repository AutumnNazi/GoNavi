import { describe, expect, it } from 'vitest';
import { resolveDefaultQueryEditorDatabase } from './queryEditorDefaultDatabase';

describe('resolveDefaultQueryEditorDatabase', () => {
  it('selects the first database when the tab has none selected', () => {
    expect(resolveDefaultQueryEditorDatabase({
      config: { type: 'mysql' },
      currentDb: '',
      databaseNames: ['information_schema', 'main'],
    })).toBe('information_schema');
  });

  it('keeps an already selected database', () => {
    expect(resolveDefaultQueryEditorDatabase({
      config: { type: 'mysql' },
      currentDb: 'main',
      databaseNames: ['information_schema', 'main'],
    })).toBe('');
  });

  it('ignores blank and padded database names', () => {
    expect(resolveDefaultQueryEditorDatabase({
      config: { type: 'mysql' },
      currentDb: '  ',
      databaseNames: ['', ' main '],
    })).toBe('main');
  });

  it('leaves elasticsearch index selection untouched', () => {
    expect(resolveDefaultQueryEditorDatabase({
      config: { type: 'elasticsearch' },
      currentDb: '',
      databaseNames: ['logs-2024'],
    })).toBe('');
  });

  it('leaves connection scoped sqlite tabs untouched', () => {
    expect(resolveDefaultQueryEditorDatabase({
      config: { type: 'sqlite' },
      currentDb: '',
      databaseNames: ['main'],
    })).toBe('');
  });

  it('returns empty when the connection has no database to select', () => {
    expect(resolveDefaultQueryEditorDatabase({
      config: { type: 'mysql' },
      currentDb: '',
      databaseNames: [],
    })).toBe('');
  });
});
