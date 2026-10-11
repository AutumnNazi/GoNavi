import { Button } from 'antd';
import {
  CheckCircleFilled,
  MacCommandOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import type { CSSProperties } from 'react';

import Modal from './common/ResizableDraggableModal';
import { useI18n } from '../i18n/provider';
import type { OverlayWorkbenchTheme } from '../utils/overlayWorkbenchTheme';
import { ANNOUNCEMENT_ACTION_BUTTON_CLASS, ANNOUNCEMENT_MODAL_CLASS } from '../utils/announcementVisuals';
import './BuiltinAIAnnouncementModal.css';

interface BuiltinAIAnnouncementModalProps {
  open: boolean;
  darkMode: boolean;
  overlayTheme: OverlayWorkbenchTheme;
  surfaceOpacity?: number;
  /** 已登录时不再展示登录步骤，主按钮改为直接打开面板。 */
  signedIn: boolean;
  /** 已按用户快捷键配置解析好的展示文案，如 ⌘J / Ctrl+J。 */
  shortcutLabel: string;
  /** 「我已知晓」：记入已读，之后不再出现。 */
  onAcknowledge: () => void;
  /** 关闭按钮 / Esc / 点遮罩：本次只是关掉，下次启动仍会提醒。 */
  onDismiss: () => void;
  onOpenPanel: () => void;
}

const STEP_KEYS = [
  'announcement.builtin_ai.login.step1',
  'announcement.builtin_ai.login.step2',
  'announcement.builtin_ai.login.step3',
] as const;

const HIGHLIGHT_KEYS = [
  { key: 'announcement.builtin_ai.highlight.free', icon: <ThunderboltOutlined /> },
  { key: 'announcement.builtin_ai.highlight.no_api_key', icon: <SettingOutlined /> },
  { key: 'announcement.builtin_ai.highlight.shortcut', icon: <MacCommandOutlined /> },
] as const;

const actionButtonStyle: CSSProperties = {
  height: 36,
  borderRadius: 12,
  paddingInline: 16,
  boxShadow: 'none',
  fontWeight: 600,
};

/** 与安全更新弹窗保持同一套透明度处理：用户调低界面不透明度时弹窗一并变淡。 */
const applySurfaceOpacity = (token: string, surfaceOpacity: number): string => {
  const normalized = Math.min(1, Math.max(0.1, surfaceOpacity));
  if (normalized >= 0.999) return token;
  return token.replace(
    /rgba\(\s*([^)]+?)\s*,\s*([0-9]*\.?[0-9]+)\s*\)/g,
    (_, channels: string, alpha: string) => (
      `rgba(${channels}, ${Number((Number(alpha) * normalized).toFixed(3))})`
    ),
  );
};

const BuiltinAIAnnouncementModal = ({
  open,
  darkMode,
  overlayTheme,
  surfaceOpacity = 1,
  signedIn,
  shortcutLabel,
  onAcknowledge,
  onDismiss,
  onOpenPanel,
}: BuiltinAIAnnouncementModalProps) => {
  const { t } = useI18n();
  const bodyTextColor = darkMode ? 'rgba(255,255,255,0.82)' : '#2f3b52';

  return (
    <Modal
      rootClassName={ANNOUNCEMENT_MODAL_CLASS}
      title={(
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
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
            <ThunderboltOutlined />
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 800, color: overlayTheme.titleText }}>
              {t('announcement.builtin_ai.title')}
            </div>
            <div style={{ marginTop: 3, color: overlayTheme.mutedText, fontSize: 12 }}>
              {t('announcement.builtin_ai.subtitle')}
            </div>
          </div>
        </div>
      )}
      open={open}
      onCancel={onDismiss}
      width={560}
      centered
      styles={{
        content: {
          border: applySurfaceOpacity(overlayTheme.shellBorder, surfaceOpacity),
          background: applySurfaceOpacity(overlayTheme.shellBg, surfaceOpacity),
          boxShadow: applySurfaceOpacity(overlayTheme.shellShadow, surfaceOpacity),
          backdropFilter: overlayTheme.shellBackdropFilter,
        },
        header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 },
        body: { paddingTop: 8 },
        footer: { background: 'transparent', borderTop: 'none', paddingTop: 10 },
      }}
      footer={[
        <Button
          key="acknowledge"
          className={ANNOUNCEMENT_ACTION_BUTTON_CLASS}
          type="primary"
          ghost
          style={actionButtonStyle}
          onClick={onAcknowledge}
        >
          {t('announcement.builtin_ai.action.acknowledge')}
        </Button>,
        <Button
          key="open-panel"
          className={ANNOUNCEMENT_ACTION_BUTTON_CLASS}
          type="primary"
          style={actionButtonStyle}
          onClick={onOpenPanel}
        >
          {t(signedIn
            ? 'announcement.builtin_ai.action.open_panel'
            : 'announcement.builtin_ai.action.use_now')}
        </Button>,
      ]}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, color: bodyTextColor, lineHeight: 1.8, fontSize: 14 }}>
        <div>{t('announcement.builtin_ai.description')}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {HIGHLIGHT_KEYS.map(({ key, icon }) => (
            <div key={key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ color: overlayTheme.iconColor, lineHeight: '22px' }}>{icon}</span>
              <span>{t(key, { shortcut: shortcutLabel })}</span>
            </div>
          ))}
        </div>

        {signedIn ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: overlayTheme.titleText,
              fontWeight: 600,
            }}
          >
            <CheckCircleFilled style={{ color: overlayTheme.iconColor }} />
            <span>{t('announcement.builtin_ai.signed_in_hint')}</span>
          </div>
        ) : (
          <div
            style={{
              border: applySurfaceOpacity(overlayTheme.sectionBorder, surfaceOpacity),
              background: applySurfaceOpacity(overlayTheme.sectionBg, surfaceOpacity),
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div style={{ fontWeight: 700, color: overlayTheme.titleText, marginBottom: 6 }}>
              {t('announcement.builtin_ai.login.title')}
            </div>
            <ol style={{ margin: 0, paddingInlineStart: 20, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {STEP_KEYS.map((key) => (
                <li key={key}>{t(key)}</li>
              ))}
            </ol>
          </div>
        )}

        <div style={{ color: overlayTheme.mutedText, fontSize: 12 }}>
          {t('announcement.builtin_ai.quota')}
        </div>
      </div>
    </Modal>
  );
};

export type { BuiltinAIAnnouncementModalProps };
export default BuiltinAIAnnouncementModal;
