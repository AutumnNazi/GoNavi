import type { AISafetyLevel } from '../../types';

export type McpHttpSurfaceMode = 'schema_only' | 'limited_query';

export const MCP_HTTP_SURFACE_MODE_KEY: Record<McpHttpSurfaceMode, string> = {
  schema_only: 'ai_settings.mcp_http.panel.mode.schema_only',
  limited_query: 'ai_settings.mcp_http.panel.mode.limited_query',
};

export const MCP_HTTP_SAFETY_LABEL_KEY: Record<AISafetyLevel, string> = {
  readonly: 'ai_settings.safety.readonly.label',
  readwrite: 'ai_settings.safety.readwrite.label',
  full: 'ai_settings.safety.full.label',
};

export const MCP_HTTP_SAFETY_TAG_COLOR: Record<AISafetyLevel, string> = {
  readonly: 'green',
  readwrite: 'gold',
  full: 'red',
};

export const normalizeMcpHttpSafetyLevel = (level?: string | null): AISafetyLevel => {
  if (level === 'readwrite' || level === 'full') {
    return level;
  }
  return 'readonly';
};

export const resolveMcpHttpSurfaceMode = (input: {
  draftSchemaOnly?: boolean;
  running?: boolean;
  statusSchemaOnly?: boolean;
}): McpHttpSurfaceMode => {
  if (input.draftSchemaOnly) {
    return 'schema_only';
  }
  if (input.running && input.statusSchemaOnly) {
    return 'schema_only';
  }
  return 'limited_query';
};
