import { describe, expect, it } from 'vitest';

import {
  MCP_HTTP_SAFETY_LABEL_KEY,
  normalizeMcpHttpSafetyLevel,
  resolveMcpHttpSurfaceMode,
} from './mcpHttpPanelMode';

describe('mcpHttpPanelMode', () => {
  it('keeps execute_sql registration independent of AI safety', () => {
    expect(resolveMcpHttpSurfaceMode({
      draftSchemaOnly: false,
      running: true,
      statusSchemaOnly: false,
    })).toBe('limited_query');
    expect(MCP_HTTP_SAFETY_LABEL_KEY.full).toBe('ai_settings.safety.full.label');
  });

  it('shows schema-only from the draft even before restart', () => {
    expect(resolveMcpHttpSurfaceMode({
      draftSchemaOnly: true,
      running: true,
      statusSchemaOnly: false,
    })).toBe('schema_only');
  });

  it('normalizes unknown safety values to readonly', () => {
    expect(normalizeMcpHttpSafetyLevel('full')).toBe('full');
    expect(normalizeMcpHttpSafetyLevel('mystery')).toBe('readonly');
  });
});
