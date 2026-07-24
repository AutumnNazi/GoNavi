import Modal from './common/ResizableDraggableModal';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Button, Empty, Tag } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';

import './SecurityUpdateSettingsModal.css';

import type { SecurityUpdateIssue, SecurityUpdateStatus } from '../types';
import {
  getSecurityUpdateIssueActionMeta,
  getSecurityUpdateIssueSeverityMeta,
  getSecurityUpdateItemStatusMeta,
  getSecurityUpdateStatusMeta,
  sortSecurityUpdateIssues,
} from '../utils/securityUpdatePresentation';
import {
  hasSecurityUpdateRecentResult,
  resolveSecurityUpdateFocusState,
  type SecurityUpdateFocusState,
  type SecurityUpdateSettingsFocusTarget,
} from '../utils/securityUpdateRepairFlow';
import type { OverlayWorkbenchTheme } from '../utils/overlayWorkbenchTheme';
import {
  SECURITY_UPDATE_ACTION_BUTTON_CLASS,
  SECURITY_UPDATE_MODAL_CLASS,
  SECURITY_UPDATE_RESULT_CARD_ACTIVE_CLASS,
  SECURITY_UPDATE_RESULT_CARD_CLASS,
  getSecurityUpdateActionButtonStyle,
  getSecurityUpdateSectionSurfaceStyle,
  getSecurityUpdateShellSurfaceStyle,
} from '../utils/securityUpdateVisuals';
import { useI18n } from '../i18n/provider';

interface SecurityUpdateSettingsModalProps {
  open: boolean;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  surfaceOpacity?: number;
  status: SecurityUpdateStatus;
  focusTarget?: SecurityUpdateSettingsFocusTarget | null;
  focusRequest?: number;
  onClose: () => void;
  onBack?: () => void;
  embedded?: boolean;
  onStart: () => void;
  onRetry: () => void;
  onRestart: () => void;
  onIssueAction: (issue: SecurityUpdateIssue) => void;
}

const sectionStyle = (
  overlayTheme: OverlayWorkbenchTheme,
  surfaceOpacity: number,
  options?: { emphasized?: boolean },
) => ({
  borderRadius: 14,
  padding: 16,
  ...getSecurityUpdateSectionSurfaceStyle(overlayTheme, {
    ...options,
    surfaceOpacity,
  }),
});

const EMPTY_FOCUS_STATE: SecurityUpdateFocusState = {
  target: null,
  pulseKey: null,
};

const SecurityUpdateSettingsModal = ({
  open,
  darkMode,
  overlayTheme,
  surfaceOpacity = 1,
  status,
  focusTarget = null,
  focusRequest = 0,
  onClose,
  onBack,
  embedded = false,
  onStart,
  onRetry,
  onRestart,
  onIssueAction,
}: SecurityUpdateSettingsModalProps) => {
  const { t } = useI18n();
  const statusMeta = getSecurityUpdateStatusMeta(status, t);
  const sortedIssues = sortSecurityUpdateIssues(status.issues);
  const showRecentResult = hasSecurityUpdateRecentResult(status);
  const showStart = status.overallStatus === 'pending' || status.overallStatus === 'postponed';
  const showRetry = status.overallStatus === 'needs_attention';
  const showRestart = status.overallStatus === 'needs_attention' || status.overallStatus === 'rolled_back';
  const actionButtonStyle = embedded ? undefined : getSecurityUpdateActionButtonStyle();
  const [activeFocus, setActiveFocus] = useState<SecurityUpdateFocusState>(EMPTY_FOCUS_STATE);
  const statusSectionRef = useRef<HTMLDivElement | null>(null);
  const recentResultRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const nextFocus = resolveSecurityUpdateFocusState(open, focusTarget, focusRequest);
    if (!nextFocus.target || !nextFocus.pulseKey) {
      setActiveFocus(EMPTY_FOCUS_STATE);
      return undefined;
    }

    const targetNode = nextFocus.target === 'recent_result'
      ? recentResultRef.current
      : statusSectionRef.current;
    if (!targetNode) {
      return undefined;
    }

    setActiveFocus(EMPTY_FOCUS_STATE);
    const animationFrame = window.requestAnimationFrame(() => {
      targetNode.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      });
      targetNode.focus({ preventScroll: true });
      setActiveFocus(nextFocus);
    });
    const highlightTimer = window.setTimeout(() => {
      setActiveFocus((current) => (
        current.pulseKey === nextFocus.pulseKey ? EMPTY_FOCUS_STATE : current
      ));
    }, 1800);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.clearTimeout(highlightTimer);
    };
  }, [focusRequest, focusTarget, open]);

  const standaloneFooter = [
    showRetry ? (
      <Button key="retry" className={SECURITY_UPDATE_ACTION_BUTTON_CLASS} style={actionButtonStyle} onClick={onRetry}>
        {t('security_update.settings.action.retry_check')}
      </Button>
    ) : null,
    showRestart ? (
      <Button key="restart" className={SECURITY_UPDATE_ACTION_BUTTON_CLASS} style={actionButtonStyle} onClick={onRestart}>
        {t('security_update.settings.action.restart_update')}
      </Button>
    ) : null,
    showStart ? (
      <Button
        key="start"
        className={SECURITY_UPDATE_ACTION_BUTTON_CLASS}
        style={actionButtonStyle}
        type="primary"
        onClick={onStart}
      >
        {t('security_update.settings.action.start')}
      </Button>
    ) : null,
    <Button key="close" className={SECURITY_UPDATE_ACTION_BUTTON_CLASS} style={actionButtonStyle} onClick={onClose}>
      {t('security_update.settings.action.close')}
    </Button>,
    onBack ? (
      <Button key="back" className={SECURITY_UPDATE_ACTION_BUTTON_CLASS} style={actionButtonStyle} onClick={onBack}>
        {t('common.back_to_previous')}
      </Button>
    ) : null,
  ];

  const embeddedFooter = [
    onBack ? (
      <Button key="back" className={SECURITY_UPDATE_ACTION_BUTTON_CLASS} onClick={onBack}>
        {t('common.back_to_settings')}
      </Button>
    ) : null,
    <Button
      key="close"
      className={SECURITY_UPDATE_ACTION_BUTTON_CLASS}
      type={!showStart && !showRetry && !showRestart ? 'primary' : 'default'}
      onClick={onClose}
    >
      {t('security_update.settings.action.close')}
    </Button>,
    showRestart ? (
      <Button
        key="restart"
        className={SECURITY_UPDATE_ACTION_BUTTON_CLASS}
        type={!showRetry && !showStart ? 'primary' : 'default'}
        onClick={onRestart}
      >
        {t('security_update.settings.action.restart_update')}
      </Button>
    ) : null,
    showRetry ? (
      <Button key="retry" className={SECURITY_UPDATE_ACTION_BUTTON_CLASS} type="primary" onClick={onRetry}>
        {t('security_update.settings.action.retry_check')}
      </Button>
    ) : null,
    showStart ? (
      <Button key="start" className={SECURITY_UPDATE_ACTION_BUTTON_CLASS} type="primary" onClick={onStart}>
        {t('security_update.settings.action.start')}
      </Button>
    ) : null,
  ];

  const embeddedThemeStyle = embedded ? ({
    '--security-update-settings-divider': overlayTheme.divider,
    '--security-update-settings-accent': overlayTheme.selectedText,
    height: 'auto',
    minHeight: '100%',
  } as CSSProperties) : undefined;

  return (
    <Modal
      rootClassName={[
        SECURITY_UPDATE_MODAL_CLASS,
        embedded ? 'security-update-settings-embedded' : '',
      ].filter(Boolean).join(' ')}
      title={embedded ? null : (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              display: 'grid',
              placeItems: 'center',
              background: overlayTheme.iconBg,
              color: overlayTheme.iconColor,
              fontSize: 18,
              flexShrink: 0,
            }}
          >
            <SafetyCertificateOutlined />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: overlayTheme.titleText }}>
              {t('security_update.settings.title')}
            </div>
            <div style={{ marginTop: 3, color: overlayTheme.mutedText, fontSize: 12 }}>
              {t('security_update.settings.subtitle')}
            </div>
          </div>
        </div>
      )}
      open={open}
      embedded={embedded}
      closable={embedded ? false : undefined}
      onCancel={onClose}
      footer={embedded ? embeddedFooter : standaloneFooter}
      width={760}
      style={embeddedThemeStyle}
      styles={{
        content: getSecurityUpdateShellSurfaceStyle(overlayTheme, surfaceOpacity),
        header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 },
        body: embedded
          ? { padding: 0, maxHeight: 'none', overflow: 'visible', flex: '1 0 auto' }
          : { paddingTop: 8, maxHeight: 640, overflowY: 'auto' },
        footer: embedded
          ? { background: 'transparent', borderTop: `1px solid ${overlayTheme.divider}`, paddingTop: 12 }
          : { background: 'transparent', borderTop: 'none', paddingTop: 10 },
      }}
    >
      <div
        className={embedded ? 'security-update-settings-layout' : undefined}
        style={embedded ? undefined : { display: 'grid', gap: 14, padding: '12px 0' }}
      >
        <div
          ref={statusSectionRef}
          tabIndex={-1}
          className={embedded ? [
            'security-update-settings-section',
            activeFocus.target === 'status' ? 'security-update-settings-section-active' : '',
          ].filter(Boolean).join(' ') : undefined}
          style={embedded
            ? undefined
            : sectionStyle(overlayTheme, surfaceOpacity, { emphasized: activeFocus.target === 'status' })}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div
                className={embedded ? 'security-update-settings-status-title' : undefined}
                style={{ fontSize: embedded ? undefined : 15, fontWeight: 700, color: overlayTheme.titleText }}
              >
                {t('security_update.settings.current_status', { status: statusMeta.label })}
              </div>
              <div
                className={embedded ? 'security-update-settings-copy' : undefined}
                style={{ marginTop: 6, fontSize: embedded ? undefined : 13, color: overlayTheme.mutedText, lineHeight: 1.7 }}
              >
                {statusMeta.description}
              </div>
            </div>
            <Tag color={
              statusMeta.tone === 'success'
                ? 'success'
                : statusMeta.tone === 'error'
                  ? 'error'
                  : statusMeta.tone === 'processing'
                    ? 'processing'
                    : statusMeta.tone === 'warning'
                      ? 'warning'
                      : 'default'
            }>
              {statusMeta.label}
            </Tag>
          </div>
        </div>

        <div
          className={embedded ? 'security-update-settings-section' : undefined}
          style={embedded ? undefined : sectionStyle(overlayTheme, surfaceOpacity)}
        >
          <div
            className={embedded ? 'security-update-settings-section-title' : undefined}
            style={{ fontSize: embedded ? undefined : 14, fontWeight: 700, color: overlayTheme.titleText, marginBottom: 12 }}
          >
            {t('security_update.settings.scope_title')}
          </div>
          <div
            className={embedded ? 'security-update-settings-summary' : undefined}
            role="list"
            style={embedded
              ? undefined
              : { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 10 }}
          >
            {[
              { label: t('security_update.settings.summary.total'), value: status.summary.total },
              { label: t('security_update.settings.summary.updated'), value: status.summary.updated },
              { label: t('security_update.settings.summary.pending'), value: status.summary.pending },
              { label: t('security_update.settings.summary.skipped'), value: status.summary.skipped },
              { label: t('security_update.settings.summary.failed'), value: status.summary.failed },
            ].map((item) => (
              <div
                key={item.label}
                className={embedded ? 'security-update-settings-summary-item' : undefined}
                role="listitem"
                style={embedded ? undefined : {
                  ...getSecurityUpdateSectionSurfaceStyle(overlayTheme, { surfaceOpacity }),
                  borderRadius: 12,
                  padding: '12px 10px',
                }}
              >
                <div
                  className={embedded ? 'security-update-settings-caption' : undefined}
                  style={{ fontSize: embedded ? undefined : 12, color: overlayTheme.mutedText }}
                >
                  {item.label}
                </div>
                <div
                  className={embedded ? 'security-update-settings-summary-value' : undefined}
                  style={{ marginTop: embedded ? 4 : 6, fontSize: embedded ? undefined : 20, fontWeight: 700, color: overlayTheme.titleText }}
                >
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div
          className={embedded ? 'security-update-settings-section' : undefined}
          style={embedded ? undefined : sectionStyle(overlayTheme, surfaceOpacity)}
        >
          <div
            className={embedded ? 'security-update-settings-section-title' : undefined}
            style={{ fontSize: embedded ? undefined : 14, fontWeight: 700, color: overlayTheme.titleText, marginBottom: 12 }}
          >
            {t('security_update.settings.pending_list')}
          </div>
          {sortedIssues.length === 0 ? (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={t('security_update.settings.empty_pending')}
            />
          ) : (
            <div className={embedded ? 'security-update-settings-issue-list' : undefined} style={embedded ? undefined : { display: 'grid', gap: 10 }}>
              {sortedIssues.map((issue) => {
                const actionMeta = getSecurityUpdateIssueActionMeta(issue, t);
                const itemStatusMeta = getSecurityUpdateItemStatusMeta(issue.status, t);
                const issueSeverityMeta = getSecurityUpdateIssueSeverityMeta(issue.severity, t);
                return (
                  <div
                    key={issue.id}
                    className={embedded ? 'security-update-settings-issue' : undefined}
                    style={embedded ? undefined : {
                      ...getSecurityUpdateSectionSurfaceStyle(overlayTheme, { surfaceOpacity }),
                      borderRadius: 12,
                      padding: 14,
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 16,
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div
                          className={embedded ? 'security-update-settings-section-title' : undefined}
                          style={{ fontSize: embedded ? undefined : 14, fontWeight: 700, color: overlayTheme.titleText }}
                        >
                          {issue.title || issue.message || issue.id}
                        </div>
                        <Tag color={itemStatusMeta.color}>
                          {t('security_update.settings.item_status', { status: itemStatusMeta.label })}
                        </Tag>
                        <Tag color={issueSeverityMeta.color}>
                          {t('security_update.settings.item_severity', { severity: issueSeverityMeta.label })}
                        </Tag>
                      </div>
                      <div
                        className={embedded ? 'security-update-settings-copy' : undefined}
                        style={{ marginTop: 6, fontSize: embedded ? undefined : 13, color: overlayTheme.mutedText, lineHeight: 1.7 }}
                      >
                        {issue.message || t('security_update.settings.item_default_message')}
                      </div>
                    </div>
                    <Button
                      className={SECURITY_UPDATE_ACTION_BUTTON_CLASS}
                      style={actionButtonStyle}
                      type={embedded ? 'default' : actionMeta.emphasis === 'primary' ? 'primary' : 'default'}
                      aria-label={`${actionMeta.label}: ${issue.title || issue.message || issue.id}`}
                      onClick={() => onIssueAction(issue)}
                    >
                      {actionMeta.label}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showRecentResult ? (
          <div
            ref={recentResultRef}
            tabIndex={-1}
            className={[
              SECURITY_UPDATE_RESULT_CARD_CLASS,
              embedded ? 'security-update-settings-section' : '',
              embedded && activeFocus.target === 'recent_result' ? 'security-update-settings-section-active' : '',
              activeFocus.target === 'recent_result' ? SECURITY_UPDATE_RESULT_CARD_ACTIVE_CLASS : '',
            ].filter(Boolean).join(' ')}
            style={embedded
              ? undefined
              : sectionStyle(overlayTheme, surfaceOpacity, { emphasized: activeFocus.target === 'recent_result' })}
          >
            <div
              className={embedded ? 'security-update-settings-section-title' : undefined}
              style={{ fontSize: embedded ? undefined : 14, fontWeight: 700, color: overlayTheme.titleText, marginBottom: 8 }}
            >
              {t('security_update.settings.recent_result')}
            </div>
            {status.backupPath ? (
              <div
                className={embedded ? 'security-update-settings-copy' : undefined}
                style={{ fontSize: embedded ? undefined : 13, color: overlayTheme.mutedText, lineHeight: 1.7 }}
              >
                {t('security_update.settings.backup_path')}
                {embedded ? (
                  <code className="security-update-settings-technical-value" style={{ color: overlayTheme.titleText }}>
                    {status.backupPath}
                  </code>
                ) : (
                  <span style={{ color: overlayTheme.titleText }}>{status.backupPath}</span>
                )}
              </div>
            ) : null}
            {status.lastError ? (
              <div
                className={embedded ? 'security-update-settings-copy' : undefined}
                style={{ marginTop: 8, fontSize: embedded ? undefined : 13, color: '#ff7875', lineHeight: 1.7 }}
              >
                {t('security_update.settings.last_error')}
                {embedded ? (
                  <code className="security-update-settings-technical-value">
                    {status.lastError}
                  </code>
                ) : status.lastError}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Modal>
  );
};

export type { SecurityUpdateSettingsModalProps };
export default SecurityUpdateSettingsModal;
