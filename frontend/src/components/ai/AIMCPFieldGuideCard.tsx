import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import type { MCPFieldGuide } from '../../utils/mcpServerGuidance';
import { buildMCPFieldTone, buildMCPHintStyle } from './AIMCPHelpBlock';

interface AIMCPFieldGuideCardProps {
  item: MCPFieldGuide;
  cardBorder: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  compact?: boolean;
}

const AIMCPFieldGuideCard: React.FC<AIMCPFieldGuideCardProps> = ({
  item,
  cardBorder,
  darkMode,
  overlayTheme,
  compact = false,
}) => {
  const i18n = useOptionalI18n();
  const copy = (key: string) => (i18n?.t ?? ((catalogKey) => catalogTranslate('en-US', catalogKey)))(key);
  const example = item.exampleKey ? copy(item.exampleKey) : item.example;
  const tone = buildMCPFieldTone(item.fieldState, darkMode);
  return (
    <div
      style={{
        padding: compact ? '10px 10px 10px 0' : '10px 10px 10px 0',
        borderBottom: `1px solid ${cardBorder}`,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>{copy(item.titleKey)}</div>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 999,
            fontSize: 'var(--gn-font-size-sm, 12px)',
            fontWeight: 700,
            color: tone.color,
            background: tone.bg,
          }}
        >
          {copy(tone.labelKey)}
        </span>
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.6, color: overlayTheme.titleText }}>{copy(item.summaryKey)}</div>
      {!compact && <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{copy(item.detailKey)}</div>}
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        <strong>{copy('ai_settings.mcp_server.guide.field.fill_label')}</strong>
        {copy(item.fillKey)}
      </div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
        <strong>{copy('ai_settings.mcp_server.guide.field.avoid_label')}</strong>
        {copy(item.avoidKey)}
      </div>
      {example ? (
        <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
          {copy('ai_settings.mcp_server.guide.field.example_label')}
          {' '}
          <code style={{ fontFamily: 'var(--gn-font-mono)' }}>{example}</code>
        </div>
      ) : null}
    </div>
  );
};

export default AIMCPFieldGuideCard;
