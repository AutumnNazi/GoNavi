import React from 'react';

import { t as catalogTranslate } from '../../i18n/catalog';
import { useOptionalI18n } from '../../i18n/provider';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';
import { buildMCPArgumentDetailHints } from '../../utils/mcpArgumentDetailHints';
import { buildMCPArgumentHintProfile } from '../../utils/mcpArgumentHints';
import { splitShellLikeCommand } from '../../utils/mcpCommandDraft';
import { buildMCPHintStyle, mcpLabelStyle } from './AIMCPHelpBlock';

interface AIMCPArgumentHintsProps {
  command: string;
  args?: string[];
  onArgsChange?: (args: string[]) => void;
  onCommandArgsChange?: (command: string, args: string[]) => void;
  cardBorder: string;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
}

const buildMissingRequiredArgs = (
  profile: NonNullable<ReturnType<typeof buildMCPArgumentHintProfile>>,
): string[] =>
  profile.steps
    .filter((step) => step.required && !step.satisfied)
    .flatMap((step) => splitShellLikeCommand(step.example).tokens)
    .map((item) => item.trim())
    .filter(Boolean);

const mergeArgs = (left: string[], right: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of [...left, ...right]) {
    const text = String(item || '').trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(text);
  }
  return result;
};

const businessHintCategoryLabel = {
  secret: 'ai_settings.mcp_server.argument_hints.category.secret',
  path: 'ai_settings.mcp_server.argument_hints.category.path',
  endpoint: 'ai_settings.mcp_server.argument_hints.category.endpoint',
  network: 'ai_settings.mcp_server.argument_hints.category.network',
  mode: 'ai_settings.mcp_server.argument_hints.category.mode',
  runtime: 'ai_settings.mcp_server.argument_hints.category.runtime',
  generic: 'ai_settings.mcp_server.argument_hints.category.generic',
};

const businessHintCategoryColor = {
  secret: '#b45309',
  path: '#7c3aed',
  endpoint: '#2563eb',
  network: '#0f766e',
  mode: '#475569',
  runtime: '#64748b',
  generic: '#64748b',
};

const AIMCPArgumentHints: React.FC<AIMCPArgumentHintsProps> = ({
  command,
  args,
  onArgsChange,
  onCommandArgsChange,
  cardBorder,
  darkMode,
  overlayTheme,
}) => {
  const i18n = useOptionalI18n();
  const copy = (
    key: string,
    params?: Record<string, string | number | boolean | null | undefined>,
  ) => (i18n?.t ?? ((catalogKey, catalogParams) => catalogTranslate('en-US', catalogKey, catalogParams)))(key, params);
  const profile = buildMCPArgumentHintProfile(command, args, copy);
  if (!profile) {
    return null;
  }
  const missingRequiredArgs = buildMissingRequiredArgs(profile);
  const argumentHints = buildMCPArgumentDetailHints(profile.commandName, [
    ...profile.inlineArgs,
    ...(args || []),
  ], copy);
  const canApplyMissingArgs = Boolean(onArgsChange && missingRequiredArgs.length > 0 && profile.inlineArgs.length === 0);
  const canSplitInlineArgs = Boolean(onCommandArgsChange && profile.inlineArgs.length > 0);

  return (
    <div
      className="gonavi-ai-mcp-argument-hints"
      style={{
        padding: '10px 0',
        borderTop: `1px solid ${cardBorder}`,
        borderBottom: `1px solid ${cardBorder}`,
        background: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>
        {copy('ai_settings.mcp_server.argument_hints.current_command', { command: profile.commandName })}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>
        {profile.title}
      </div>
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{profile.summary}</div>
      {profile.commandFieldWarning ? (
        <div style={buildMCPHintStyle('#b45309')}>{profile.commandFieldWarning}</div>
      ) : null}
      <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{profile.orderHint}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {profile.steps.map((step) => (
          <span
            key={step.key}
            style={{
              padding: '4px 9px',
              borderRadius: 999,
              fontSize: 12,
              border: `1px solid ${cardBorder}`,
              color: step.satisfied ? '#16a34a' : (step.required ? '#b45309' : overlayTheme.mutedText),
              background: step.satisfied
                ? (darkMode ? 'rgba(34,197,94,0.14)' : 'rgba(34,197,94,0.10)')
                : (darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.82)'),
            }}
            title={step.detail}
          >
            {step.label}: <code style={{ fontFamily: 'var(--gn-font-mono)' }}>{step.example}</code>
            {step.required ? ' *' : ''}
          </span>
        ))}
      </div>
      {argumentHints.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>
            {copy('ai_settings.mcp_server.argument_hints.argument_details')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {argumentHints.map((hint) => (
              <div
                className="gonavi-ai-mcp-argument-hint-row"
                key={hint.key}
                style={{
                  padding: '8px 10px 8px 0',
                  borderBottom: `1px solid ${cardBorder}`,
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <code style={{ fontFamily: 'var(--gn-font-mono)', fontSize: 12, color: overlayTheme.titleText }}>
                    {hint.argument}
                  </code>
                  <span
                    style={{
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontSize: 'var(--gn-font-size-sm, 12px)',
                      fontWeight: 700,
                      color: businessHintCategoryColor[hint.category],
                      background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
                    }}
                  >
                    {copy(businessHintCategoryLabel[hint.category])}
                  </span>
                  {hint.sensitive ? (
                    <span style={buildMCPHintStyle('#b45309')}>
                      {copy('ai_settings.mcp_server.argument_hints.masked_value')}
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>{hint.label}</div>
                <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{hint.detail}</div>
                <div style={buildMCPHintStyle(hint.sensitive ? '#b45309' : overlayTheme.mutedText)}>
                  {copy('ai_settings.mcp_server.argument_hints.value_hint_prefix')}{hint.valueHint}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {profile.businessHints.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ ...mcpLabelStyle, color: overlayTheme.titleText }}>
            {copy('ai_settings.mcp_server.argument_hints.business_arguments')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {profile.businessHints.map((hint) => (
              <div
                className="gonavi-ai-mcp-argument-hint-row"
                key={hint.key}
                style={{
                  padding: '8px 10px 8px 0',
                  borderBottom: `1px solid ${cardBorder}`,
                  background: 'transparent',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  <code style={{ fontFamily: 'var(--gn-font-mono)', fontSize: 12, color: overlayTheme.titleText }}>
                    {hint.argument}
                  </code>
                  <span
                    style={{
                      padding: '1px 7px',
                      borderRadius: 999,
                      fontSize: 'var(--gn-font-size-sm, 12px)',
                      fontWeight: 700,
                      color: businessHintCategoryColor[hint.category],
                      background: darkMode ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.05)',
                    }}
                  >
                    {copy(businessHintCategoryLabel[hint.category])}
                  </span>
                  {hint.sensitive ? (
                    <span style={buildMCPHintStyle('#b45309')}>
                      {copy('ai_settings.mcp_server.argument_hints.dont_screenshot')}
                    </span>
                  ) : null}
                </div>
                <div style={{ fontSize: 12, fontWeight: 700, color: overlayTheme.titleText }}>{hint.label}</div>
                <div style={buildMCPHintStyle(overlayTheme.mutedText)}>{hint.detail}</div>
                <div style={buildMCPHintStyle(hint.sensitive ? '#b45309' : overlayTheme.mutedText)}>
                  {copy('ai_settings.mcp_server.argument_hints.value_hint_prefix')}{hint.valueHint}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {profile.nextActions.length > 0 ? (
        <div style={buildMCPHintStyle('#b45309')}>
          {copy('ai_settings.mcp_server.argument_hints.next_actions', {
            actions: profile.nextActions.join(copy('ai_settings.mcp_server.argument_hints.action_separator')),
          })}
        </div>
      ) : (
        <div style={buildMCPHintStyle(overlayTheme.mutedText)}>
          {copy('ai_settings.mcp_server.argument_hints.required_complete')}
        </div>
      )}
      {canApplyMissingArgs ? (
        <button
          type="button"
          onClick={() => onArgsChange?.([...(args || []), ...missingRequiredArgs])}
          style={{
            alignSelf: 'flex-start',
            padding: '5px 11px',
            borderRadius: 999,
            border: `1px solid ${cardBorder}`,
            background: darkMode ? 'rgba(245,158,11,0.14)' : 'rgba(245,158,11,0.10)',
            color: '#b45309',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {copy('ai_settings.mcp_server.argument_hints.fill_missing_required', {
            args: missingRequiredArgs.join(' / '),
          })}
        </button>
      ) : null}
      {canSplitInlineArgs ? (
        <button
          type="button"
          onClick={() => onCommandArgsChange?.(
            profile.normalizedCommand,
            mergeArgs(profile.inlineArgs, args || []),
          )}
          style={{
            alignSelf: 'flex-start',
            padding: '5px 11px',
            borderRadius: 999,
            border: `1px solid ${cardBorder}`,
            background: darkMode ? 'rgba(37,99,235,0.16)' : 'rgba(37,99,235,0.10)',
            color: '#2563eb',
            fontSize: 12,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          {copy('ai_settings.mcp_server.argument_hints.split_inline_args', {
            command: profile.normalizedCommand,
            count: profile.inlineArgs.length,
          })}
        </button>
      ) : null}
    </div>
  );
};

export default AIMCPArgumentHints;
