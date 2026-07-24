import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { AIMCPToolDescriptor } from '../../types';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { buildMCPHintStyle } from './AIMCPHelpBlock';

const MAX_PARAMETER_PREVIEW = 6;

type JSONSchemaRecord = Record<string, any>;

const isRecord = (value: unknown): value is JSONSchemaRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readSchemaType = (schema: JSONSchemaRecord): string => {
  if (Array.isArray(schema.type)) {
    return schema.type.map((item) => String(item)).filter(Boolean).join('|') || 'unknown';
  }
  if (typeof schema.type === 'string' && schema.type.trim()) {
    return schema.type.trim();
  }
  if (Array.isArray(schema.enum)) {
    return 'enum';
  }
  if (isRecord(schema.properties)) {
    return 'object';
  }
  if (isRecord(schema.items)) {
    return 'array';
  }
  return 'unknown';
};

const readRequiredSet = (schema: JSONSchemaRecord): Set<string> => new Set(
  Array.isArray(schema.required)
    ? schema.required.map((item) => String(item)).filter(Boolean)
    : [],
);

const readExampleValue = (name: string, schema: JSONSchemaRecord): unknown => {
  if (Object.prototype.hasOwnProperty.call(schema, 'default')) {
    const value = schema.default;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      return value;
    }
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const value = schema.enum[0];
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      return value;
    }
  }

  const type = readSchemaType(schema);
  if (type.includes('boolean')) return false;
  if (type.includes('number') || type.includes('integer')) return 0;
  if (type.includes('array')) return [];
  if (type.includes('object')) return {};
  return `<${name}>`;
};

export const buildMCPToolMinimalArgumentsExample = (tool: AIMCPToolDescriptor): string => {
  const inputSchema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const requiredSet = readRequiredSet(inputSchema);
  const example = Object.entries(properties).reduce<Record<string, unknown>>((acc, [name, rawSchema]) => {
    if (!requiredSet.has(name)) {
      return acc;
    }
    acc[name] = readExampleValue(name, isRecord(rawSchema) ? rawSchema : {});
    return acc;
  }, {});
  return JSON.stringify(example);
};

const summarizeToolParameters = (tool: AIMCPToolDescriptor) => {
  const inputSchema = isRecord(tool.inputSchema) ? tool.inputSchema : {};
  const properties = isRecord(inputSchema.properties) ? inputSchema.properties : {};
  const requiredSet = readRequiredSet(inputSchema);
  const parameters = Object.entries(properties).map(([name, rawSchema]) => {
    const schema = isRecord(rawSchema) ? rawSchema : {};
    return {
      name,
      required: requiredSet.has(name),
      type: readSchemaType(schema),
      description: String(schema.description || schema.title || '').trim(),
    };
  });

  return {
    hasInputSchema: Object.keys(inputSchema).length > 0,
    parameters,
    requiredCount: parameters.filter((item) => item.required).length,
    minimalArgumentsExample: buildMCPToolMinimalArgumentsExample(tool),
    truncated: parameters.length > MAX_PARAMETER_PREVIEW,
  };
};

interface AIMCPToolSchemaSummaryProps {
  tools: AIMCPToolDescriptor[];
  cardBorder: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
}

const AIMCPToolSchemaSummary: React.FC<AIMCPToolSchemaSummaryProps> = ({
  tools,
  cardBorder,
  darkMode,
  overlayTheme,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => (i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams)))(key, params);

  if (tools.length === 0) {
    return null;
  }

  return (
    <div className="gonavi-ai-mcp-tool-schema" style={{ padding: '10px 0', borderTop: `1px solid ${cardBorder}`, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>
        {copy('ai_settings.mcp_server.tool_schema_summary.title')}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 8 }}>
        {tools.map((tool) => {
          const summary = summarizeToolParameters(tool);
          const previewParameters = summary.parameters.slice(0, MAX_PARAMETER_PREVIEW);
          return (
            <div
              className="gonavi-ai-mcp-tool-schema-row"
              key={tool.alias}
              style={{
                padding: '10px 10px 10px 0',
                borderBottom: `1px solid ${cardBorder}`,
                background: 'transparent',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText, overflowWrap: 'anywhere' }}>
                {tool.alias}
              </div>
              {tool.description ? (
                <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{tool.description}</div>
              ) : null}
              <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
                {summary.hasInputSchema
                  ? copy('ai_settings.mcp_server.tool_schema_summary.parameter_counts', {
                    count: summary.parameters.length,
                    requiredCount: summary.requiredCount,
                  })
                  : copy('ai_settings.mcp_server.tool_schema_summary.no_input_schema')}
              </div>
              {summary.hasInputSchema ? (
                <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
                  {copy('ai_settings.mcp_server.tool_schema_summary.minimal_arguments_example')}
                  {' '}
                  <code style={{ fontFamily: 'var(--gn-font-mono)', overflowWrap: 'anywhere' }}>
                    {summary.minimalArgumentsExample}
                  </code>
                </div>
              ) : null}
              {previewParameters.length > 0 ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {previewParameters.map((parameter) => (
                    <span
                      key={parameter.name}
                      title={parameter.description || undefined}
                      style={{
                        padding: '3px 7px',
                        borderRadius: 999,
                        background: parameter.required
                          ? (darkMode ? 'rgba(59,130,246,0.18)' : 'rgba(37,99,235,0.10)')
                          : (darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)'),
                        color: parameter.required ? '#2563eb' : overlayTheme.mutedText,
                        fontSize: 12,
                        fontFamily: 'var(--gn-font-mono)',
                      }}
                    >
                      {parameter.name}
                      {parameter.required ? '*' : ''}: {parameter.type}
                    </span>
                  ))}
                  {summary.truncated ? (
                    <span style={{ ...buildMCPHintStyle(overlayTheme.mutedText), padding: '3px 0' }}>
                      {copy('ai_settings.mcp_server.tool_schema_summary.more_parameters', {
                        count: summary.parameters.length - MAX_PARAMETER_PREVIEW,
                      })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AIMCPToolSchemaSummary;
