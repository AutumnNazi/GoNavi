export const buildQueryEditorMetadataRenderContextKey = (
  tabId: string,
  connectionId: string,
  dbName: string,
): string => `${tabId}\u0000${connectionId}\u0000${dbName}`;

export const buildQueryEditorTableNavigationContextKey = (
  tabId: string,
  connectionId: string,
  dbName: string,
  schemaName: string,
): string => `${tabId}\u0000${connectionId}\u0000${dbName}\u0000${schemaName}`;
