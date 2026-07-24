import React, { useRef, useState } from 'react';
import { ApartmentOutlined, RightOutlined, SearchOutlined, ToolOutlined } from '@ant-design/icons';

import {
  describeBuiltinToolParameters,
  filterBuiltinToolFlows,
  filterBuiltinTools,
  localizeBuiltinToolFlows,
} from '../../utils/aiBuiltinToolCatalog';
import { useI18n } from '../../i18n/provider';
import { localizeBuiltinAIToolInfo } from '../../utils/aiToolRegistry';
import type { OverlayWorkbenchTheme } from '../../utils/overlayWorkbenchTheme';

interface AIBuiltinToolsCatalogProps {
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  cardBg: string;
  cardBorder: string;
}

type AIBuiltinToolsCatalogView = 'flows' | 'tools';

export const AIBuiltinToolsCatalog: React.FC<AIBuiltinToolsCatalogProps> = ({
  darkMode,
  overlayTheme,
  cardBorder,
}) => {
  const { t } = useI18n();
  const [searchText, setSearchText] = useState('');
  const [activeView, setActiveView] = useState<AIBuiltinToolsCatalogView>('flows');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const builtinToolFlows = localizeBuiltinToolFlows(t);
  const builtinToolInfo = localizeBuiltinAIToolInfo(t);
  const visibleFlows = filterBuiltinToolFlows(builtinToolFlows, searchText);
  const visibleTools = filterBuiltinTools(builtinToolInfo, searchText);
  const catalogViews = [
    {
      key: 'flows' as const,
      label: t('ai_settings.tools.view.flows'),
      icon: ApartmentOutlined,
      visibleCount: visibleFlows.length,
      totalCount: builtinToolFlows.length,
    },
    {
      key: 'tools' as const,
      label: t('ai_settings.tools.view.tools'),
      icon: ToolOutlined,
      visibleCount: visibleTools.length,
      totalCount: builtinToolInfo.length,
    },
  ];

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        '--gn-ai-disclosure-accent': overlayTheme.selectedText,
        '--gn-ai-disclosure-accent-bg': overlayTheme.selectedBg,
      } as React.CSSProperties}
    >
      <div style={{ fontSize: 'var(--gn-settings-font-secondary, 13px)', color: overlayTheme.mutedText, marginBottom: 4 }}>
        {t('ai_settings.tools.description')}
      </div>
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 32,
          padding: '0 10px',
          borderRadius: 6,
          border: `1px solid ${cardBorder}`,
          background: darkMode ? 'rgba(255,255,255,0.03)' : 'transparent',
        }}
      >
        <SearchOutlined style={{ color: overlayTheme.mutedText }} />
        <input
          ref={searchInputRef}
          type="search"
          aria-label={t('ai_settings.tools.search.aria_label')}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          placeholder={t('ai_settings.tools.search.placeholder')}
          style={{
            flex: 1,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: overlayTheme.titleText,
            fontSize: 'var(--gn-settings-font-secondary, 13px)',
          }}
        />
        {searchText && (
          <button
            type="button"
            aria-label={t('ai_settings.tools.search.clear')}
            onClick={() => {
              setSearchText('');
              searchInputRef.current?.focus();
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: overlayTheme.mutedText,
              cursor: 'pointer',
              fontSize: 'var(--gn-font-size-sm, 12px)',
            }}
          >
            {t('ai_settings.tools.search.clear')}
          </button>
        )}
      </label>
      <div
        className="gonavi-ai-tool-view-tabs"
        role="tablist"
        aria-label={t('ai_settings.tools.builtin_tool_label')}
      >
        {catalogViews.map((view, viewIndex) => {
          const active = activeView === view.key;
          const ViewIcon = view.icon;
          return (
            <button
              key={view.key}
              id={`gonavi-ai-tool-view-tab-${view.key}`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`gonavi-ai-tool-view-panel-${view.key}`}
              tabIndex={active ? 0 : -1}
              className={`gonavi-ai-tool-view-tab${active ? ' is-active' : ''}`}
              onClick={() => setActiveView(view.key)}
              onKeyDown={(event) => {
                if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) {
                  return;
                }
                event.preventDefault();
                const nextIndex = event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? catalogViews.length - 1
                    : event.key === 'ArrowRight'
                      ? (viewIndex + 1) % catalogViews.length
                      : (viewIndex - 1 + catalogViews.length) % catalogViews.length;
                setActiveView(catalogViews[nextIndex].key);
                const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]');
                tabButtons?.[nextIndex]?.focus();
              }}
              style={{ color: active ? overlayTheme.selectedText : overlayTheme.mutedText }}
            >
              <ViewIcon className="gonavi-ai-tool-view-tab-icon" aria-hidden="true" />
              <span className="gonavi-ai-tool-view-tab-label">{view.label}</span>
              <span className="gonavi-ai-tool-view-count">
                {view.visibleCount}/{view.totalCount}
              </span>
            </button>
          );
        })}
      </div>
      <div
        id="gonavi-ai-tool-view-panel-flows"
        role="tabpanel"
        aria-labelledby="gonavi-ai-tool-view-tab-flows"
        hidden={activeView !== 'flows'}
      >
        {visibleFlows.length > 0 ? (
          <div className="gonavi-ai-tool-flow-list" style={{ display: 'grid', gap: 2 }}>
            {visibleFlows.map((flow) => (
              <details
                key={flow.title}
                className="gonavi-ai-settings-disclosure gonavi-ai-tool-flow-row"
                style={{ borderRadius: 4 }}
              >
                <summary style={{ color: overlayTheme.titleText }}>
                  <span
                    className="gonavi-ai-settings-disclosure-content"
                    style={{
                      display: 'inline-grid',
                      gridTemplateColumns: '18px minmax(0, 1fr)',
                      alignItems: 'center',
                      gap: 9,
                    }}
                  >
                    <ApartmentOutlined style={{ color: overlayTheme.iconColor, fontSize: 14 }} aria-hidden="true" />
                    <span style={{ minWidth: 0 }}>
                      <span
                        style={{
                          display: 'block',
                          color: overlayTheme.titleText,
                          fontSize: 'var(--gn-settings-font-secondary, 13px)',
                          fontWeight: 650,
                        }}
                      >
                        {flow.title}
                      </span>
                      <code
                        style={{
                          display: 'block',
                          marginTop: 3,
                          color: overlayTheme.mutedText,
                          fontFamily: 'var(--gn-font-mono)',
                          fontSize: 'var(--gn-font-size-sm, 12px)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {flow.steps}
                      </code>
                    </span>
                  </span>
                  <RightOutlined className="gonavi-ai-settings-disclosure-icon" aria-hidden="true" />
                </summary>
                <div style={{ padding: '0 2px 14px 29px', fontSize: 'var(--gn-settings-font-secondary, 13px)', color: overlayTheme.mutedText, lineHeight: 1.6 }}>
                  {flow.description}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="gonavi-ai-tool-view-empty" style={{ color: overlayTheme.mutedText }}>
            {t('ai_settings.tools.empty.no_flow_matches')}
          </div>
        )}
      </div>
      <div
        id="gonavi-ai-tool-view-panel-tools"
        role="tabpanel"
        aria-labelledby="gonavi-ai-tool-view-tab-tools"
        hidden={activeView !== 'tools'}
      >
        {visibleTools.length > 0 ? (
          <div className="gonavi-ai-tool-list" style={{ display: 'grid', gap: 2 }}>
            {visibleTools.map((tool) => {
              const parameterDetails = describeBuiltinToolParameters(tool);
              return (
                <details
                  key={tool.name}
                  className="gonavi-ai-settings-disclosure gonavi-ai-tool-row"
                  style={{ borderRadius: 4 }}
                >
                  <summary style={{ color: overlayTheme.titleText }}>
                    <span
                      className="gonavi-ai-settings-disclosure-content"
                      style={{
                        display: 'inline-grid',
                        gridTemplateColumns: '18px minmax(0, 1fr)',
                        alignItems: 'center',
                        gap: 9,
                      }}
                    >
                      <ToolOutlined style={{ color: overlayTheme.iconColor, fontSize: 14 }} aria-hidden="true" />
                      <span style={{ minWidth: 0 }}>
                        <code
                          style={{
                            display: 'block',
                            color: overlayTheme.titleText,
                            fontFamily: 'var(--gn-font-mono)',
                            fontSize: 'var(--gn-settings-font-secondary, 13px)',
                            fontWeight: 650,
                          }}
                        >
                          {tool.name}
                        </code>
                        <span
                          style={{
                            display: 'block',
                            marginTop: 3,
                            fontSize: 'var(--gn-font-size-sm, 12px)',
                            color: overlayTheme.mutedText,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {tool.desc}
                        </span>
                      </span>
                    </span>
                    <RightOutlined className="gonavi-ai-settings-disclosure-icon" aria-hidden="true" />
                  </summary>
                  <div style={{ padding: '0 2px 14px 29px' }}>
                    <div style={{ fontSize: 'var(--gn-settings-font-secondary, 13px)', color: overlayTheme.mutedText, lineHeight: 1.6 }}>
                      {tool.detail}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        fontSize: 'var(--gn-font-size-sm, 12px)',
                        color: overlayTheme.mutedText,
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      <span>{t('ai_settings.tools.params_label')}</span>
                      <code style={{ fontFamily: 'var(--gn-font-mono)', fontSize: 'var(--gn-font-size-sm, 12px)' }}>
                        {tool.params}
                      </code>
                    </div>
                    {parameterDetails.length > 0 && (
                      <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                        <div style={{ fontSize: 'var(--gn-font-size-sm, 12px)', fontWeight: 700, color: overlayTheme.titleText }}>
                          {t('ai_settings.tools.parameters.hint_title')}
                        </div>
                        <div style={{ display: 'grid', gap: 8 }}>
                          {parameterDetails.map((item) => (
                            <div
                              key={`${tool.name}-${item.name}`}
                              style={{
                                padding: '8px 0',
                                borderTop: `1px solid ${cardBorder}`,
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 4,
                              }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <code style={{ fontFamily: 'var(--gn-font-mono)', fontSize: 'var(--gn-font-size-sm, 12px)' }}>{item.name}</code>
                                <span style={{ fontSize: 'var(--gn-font-size-sm, 12px)', color: overlayTheme.mutedText }}>
                                  {t('ai_settings.tools.parameters.type_label', { type: item.typeLabel })}
                                </span>
                                <span
                                  style={{
                                    padding: '1px 8px',
                                    borderRadius: 999,
                                    fontSize: 'var(--gn-font-size-sm, 12px)',
                                    fontWeight: 700,
                                    color: item.required ? '#b45309' : '#475569',
                                    background: item.required
                                      ? (darkMode ? 'rgba(245,158,11,0.18)' : 'rgba(245,158,11,0.12)')
                                      : (darkMode ? 'rgba(148,163,184,0.18)' : 'rgba(148,163,184,0.12)'),
                                  }}
                                >
                                  {item.required ? t('ai_settings.tools.parameters.required') : t('ai_settings.tools.parameters.optional')}
                                </span>
                                {item.enumValues.length > 0 && (
                                  <span style={{ fontSize: 'var(--gn-font-size-sm, 12px)', color: overlayTheme.mutedText }}>
                                    {t('ai_settings.tools.parameters.enum_values', { values: item.enumValues.join(' / ') })}
                                  </span>
                                )}
                                {item.defaultValue && (
                                  <span style={{ fontSize: 'var(--gn-font-size-sm, 12px)', color: overlayTheme.mutedText }}>
                                    {t('ai_settings.tools.parameters.default_value', { value: item.defaultValue })}
                                  </span>
                                )}
                              </div>
                              {item.description && (
                                <div style={{ fontSize: 'var(--gn-font-size-sm, 12px)', color: overlayTheme.mutedText, lineHeight: 1.6 }}>{item.description}</div>
                              )}
                              {item.exampleValue && (
                                <div style={{ fontSize: 'var(--gn-font-size-sm, 12px)', color: overlayTheme.mutedText, lineHeight: 1.6 }}>
                                  {t('ai_settings.tools.parameters.example')}
                                  <code style={{ fontFamily: 'var(--gn-font-mono)' }}>{item.exampleValue}</code>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
          </div>
        ) : (
          <div className="gonavi-ai-tool-view-empty" style={{ color: overlayTheme.mutedText }}>
            {t('ai_settings.tools.empty.no_matches')}
          </div>
        )}
      </div>
    </div>
  );
};

export default AIBuiltinToolsCatalog;
