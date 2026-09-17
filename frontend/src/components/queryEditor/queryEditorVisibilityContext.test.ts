import { describe, expect, it } from 'vitest';

import {
  buildQueryEditorMetadataRenderContextKey,
  buildQueryEditorTableNavigationContextKey,
} from './queryEditorVisibilityContext';

describe('query editor visibility context', () => {
  it('builds stable keys that ignore whether the tab is currently active', () => {
    expect(buildQueryEditorMetadataRenderContextKey('query-1', 'conn-1', 'db')).toBe(
      buildQueryEditorMetadataRenderContextKey('query-1', 'conn-1', 'db'),
    );
    expect(buildQueryEditorTableNavigationContextKey('query-1', 'conn-1', 'db', 'public')).toBe(
      buildQueryEditorTableNavigationContextKey('query-1', 'conn-1', 'db', 'public'),
    );
  });

  it('changes when the tab, connection, database, or schema changes', () => {
    const base = buildQueryEditorMetadataRenderContextKey('query-1', 'conn-1', 'db');
    expect(buildQueryEditorMetadataRenderContextKey('query-2', 'conn-1', 'db')).not.toBe(base);
    expect(buildQueryEditorMetadataRenderContextKey('query-1', 'conn-2', 'db')).not.toBe(base);
    expect(buildQueryEditorMetadataRenderContextKey('query-1', 'conn-1', 'other')).not.toBe(base);

    const nav = buildQueryEditorTableNavigationContextKey('query-1', 'conn-1', 'db', 'public');
    expect(buildQueryEditorTableNavigationContextKey('query-1', 'conn-1', 'db', 'sales')).not.toBe(nav);
  });
});
