import React from 'react';
import { Button, Empty, Tooltip } from 'antd';
import { BugOutlined, ClearOutlined, CloseOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import { useI18n } from '../i18n/provider';
import { normalizeOpacityForPlatform, resolveAppearanceValues } from '../utils/appearance';
import { QueryEditorExecutionErrorCard } from './queryEditor/QueryEditorExecutionErrorCard';
import LogPanelList from './LogPanelList';
import './LogPanel.css';
interface LogPanelProps {
    height?: number;
    onClose?: () => void;
    onResizeStart?: (e: React.MouseEvent) => void;
    variant?: 'panel' | 'embedded';
    executionError?: string;
    onDiagnoseExecutionError?: () => void;
    diagnoseShortcutLabel?: string;
    onLocateExecutionError?: () => void;
}

const LogPanel: React.FC<LogPanelProps> = ({
    height = 260,
    onClose,
    onResizeStart,
    variant = 'panel',
    executionError,
    onDiagnoseExecutionError,
    diagnoseShortcutLabel,
    onLocateExecutionError,
}) => {
    const { t } = useI18n();
    const sqlLogs = useStore(state => state.sqlLogs);
    const clearSqlLogs = useStore(state => state.clearSqlLogs);
    const theme = useStore(state => state.theme);
    const appearance = useStore(state => state.appearance);
    const darkMode = theme === 'dark';

    const resolvedAppearance = resolveAppearanceValues(appearance);
    const opacity = normalizeOpacityForPlatform(resolvedAppearance.opacity);
    const panelDividerColor = 'var(--gn-br-2)';
    const panelMutedTextColor = 'var(--gn-fg-4)';
    const panelPrimaryTextColor = 'var(--gn-fg-1)';
    const panelShellBg = 'var(--gn-bg-panel)';
    const panelAccentColor = 'var(--gn-accent)';
    const panelAccentSoftBg = 'var(--gn-accent-soft)';
    const panelShadow = 'var(--gn-shadow-md)';
    const logScrollbarThumb = darkMode
        ? `rgba(255, 255, 255, ${Math.max(0.18, opacity * 0.34)})`
        : `rgba(0, 0, 0, ${Math.max(0.12, opacity * 0.26)})`;
    const logScrollbarThumbHover = darkMode
        ? `rgba(255, 255, 255, ${Math.max(0.28, opacity * 0.48)})`
        : `rgba(0, 0, 0, ${Math.max(0.18, opacity * 0.36)})`;
    const isEmbedded = variant === 'embedded';
    const logBody = sqlLogs.length === 0 ? (
        <div
            className="log-panel-scroll"
            style={{
                flex: 1,
                overflow: 'auto',
                padding: isEmbedded ? '0 0 12px' : '8px 10px 10px',
            }}
        >
            <div style={{ height: '100%', minHeight: 160, display: 'grid', placeItems: 'center' }}>
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span style={{ color: panelMutedTextColor }}>{t('log_panel.empty')}</span>}
                />
            </div>
        </div>
    ) : (
        <LogPanelList
            logs={sqlLogs}
            darkMode={darkMode}
            mutedColor={panelMutedTextColor}
            affectedRowsLabel={(count) => t('log_panel.affected_rows', { count })}
            padding={isEmbedded ? '0 0 12px' : '8px 10px 10px'}
            scrollThumb={logScrollbarThumb}
            scrollThumbHover={logScrollbarThumbHover}
        />
    );

    if (isEmbedded) {
        return (
            <div
                className="log-panel-embedded"
                style={{
                    flex: 1,
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    background: 'var(--gn-query-workbench-bg, var(--gn-bg-panel-2))',
                }}
            >
                {executionError && (
                    <div style={{ padding: '12px 12px 0' }}>
                        <div style={{
                            padding: 14,
                            borderRadius: 8,
                            border: `1px solid ${darkMode ? '#5c2020' : '#ffccc7'}`,
                            background: darkMode ? '#2d1a1a' : '#fff2f0',
                        }}>
                            <QueryEditorExecutionErrorCard
                                compact
                                darkMode={darkMode}
                                error={executionError}
                                onDiagnose={onDiagnoseExecutionError}
                                diagnoseShortcutLabel={diagnoseShortcutLabel}
                                onLocate={onLocateExecutionError}
                            />
                        </div>
                    </div>
                )}
                {logBody}
            </div>
        );
    }

    return (
        <div style={{
            height,
            margin: 0,
            border: `1px solid ${panelDividerColor}`,
            borderRadius: 14,
            background: panelShellBg,
            WebkitBackdropFilter: opacity < 0.999 ? 'blur(14px)' : 'none',
            boxShadow: panelShadow,
            backdropFilter: darkMode && opacity < 0.999 ? 'blur(18px)' : 'none',
            display: 'flex',
            flexDirection: 'column',
            position: 'relative',
            overflow: 'hidden',
            zIndex: 100
        }}>
            {/* Resize Handle */}
            {onResizeStart && (
                <div
                    onMouseDown={onResizeStart}
                    style={{
                        position: 'absolute',
                        top: -4,
                        left: 0,
                        right: 0,
                        height: 8,
                        cursor: 'row-resize',
                        zIndex: 10
                    }}
                />
            )}

            {/* Toolbar */}
            <div style={{
                padding: '10px 14px',
                borderBottom: `1px solid ${panelDividerColor}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                minHeight: 48
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <div style={{ width: 30, height: 30, borderRadius: 10, display: 'grid', placeItems: 'center', background: panelAccentSoftBg, color: panelAccentColor, flexShrink: 0 }}>
                        <BugOutlined />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, color: panelPrimaryTextColor }}>{t('log_panel.title')}</div>
                        <div style={{ fontSize: 12, color: panelMutedTextColor }}>{t('log_panel.description')}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Tooltip title={t('log_panel.action.clear')}>
                        <Button type="text" size="small" icon={<ClearOutlined />} onClick={clearSqlLogs} style={{ color: panelMutedTextColor }} />
                    </Tooltip>
                    {onClose && (
                        <Tooltip title={t('log_panel.action.close')}>
                            <Button type="text" size="small" icon={<CloseOutlined />} onClick={onClose} style={{ color: panelMutedTextColor }} />
                        </Tooltip>
                    )}
                </div>
            </div>

            {logBody}
        </div>
    );
};

export default LogPanel;
