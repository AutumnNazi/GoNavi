import React from 'react';
import { Button, Input, Switch, message } from 'antd';
import {
  SHORTCUT_ACTION_ORDER, SHORTCUT_ACTION_META, resolveShortcutBinding, splitConflictsByContext,
  getShortcutDisplayLabel,
} from '../../utils/shortcuts';
import Modal from '../common/ResizableDraggableModal';
import type { AppCoreStateApi } from '../../appShell/hooks/useAppCoreState';
import type { AppProxySettingsApi } from '../../appShell/hooks/useAppProxySettings';
import type { AppUpdateAndDiagnosticsApi } from '../../appShell/hooks/useAppUpdateAndDiagnostics';
import type { AppShellStateApi } from '../../appShell/hooks/useAppShellState';

export interface ShortcutSettingsPaneProps {
  t: AppCoreStateApi['t'];
  darkMode: AppCoreStateApi['darkMode'];
  utilityPanelStyle: React.CSSProperties;
  isMacRuntime: AppShellStateApi['isMacRuntime'];
  shortcutOptions: AppCoreStateApi['shortcutOptions'];
  activeShortcutPlatform: AppUpdateAndDiagnosticsApi['activeShortcutPlatform'];
  capturingShortcutAction: AppProxySettingsApi['capturingShortcutAction'];
  setCapturingShortcutAction: AppProxySettingsApi['setCapturingShortcutAction'];
  shortcutConflictMap: AppProxySettingsApi['shortcutConflictMap'];
  resolvedMonoFontFamily: AppShellStateApi['resolvedMonoFontFamily'];
  updateShortcut: AppCoreStateApi['updateShortcut'];
  resetShortcutOptions: AppCoreStateApi['resetShortcutOptions'];
  onClose: () => void;
}

/** 设置中心「偏好设置 → 快捷键管理」面板：录制、启停与冲突展示。 */
const ShortcutSettingsPane: React.FC<ShortcutSettingsPaneProps> = ({
  t, darkMode, utilityPanelStyle, isMacRuntime, shortcutOptions, activeShortcutPlatform,
  capturingShortcutAction, setCapturingShortcutAction, shortcutConflictMap,
  resolvedMonoFontFamily, updateShortcut, resetShortcutOptions, onClose,
}) => (
  <Modal
    embedded
    open
    title={null}
    closable={false}
    onCancel={() => {
      setCapturingShortcutAction(null);
      onClose();
    }}
    footer={(
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button
          key="reset"
          style={{ marginRight: 'auto' }}
          onClick={() => {
            resetShortcutOptions();
            setCapturingShortcutAction(null);
            void message.success(t('app.shortcuts.message.restored_defaults'));
          }}
        >
          {t('app.shortcuts.action.restore_defaults')}
        </Button>
        <Button
          key="close"
          type="primary"
          onClick={() => {
            setCapturingShortcutAction(null);
            onClose();
          }}
        >
          {t('common.close')}
        </Button>
      </div>
    )}
    styles={{
      header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 },
      body: { paddingTop: 8, overflow: 'hidden', flex: 1, minHeight: 0 },
      footer: { background: 'transparent', borderTop: 'none', paddingTop: 10 },
    }}
  >
    <div data-gonavi-shortcut-modal-scroll="true" className="gonavi-settings-center-pane-scroll" style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8, paddingRight: 4 }}>
      <div style={utilityPanelStyle}>
        <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>
          {t('app.shortcuts.capture_hint')}
        </div>
      </div>
      {SHORTCUT_ACTION_ORDER.map((action) => {
        const meta = SHORTCUT_ACTION_META[action];
        if (meta.platformOnly === 'mac' && !isMacRuntime) {
          return null;
        }
        const binding = resolveShortcutBinding(shortcutOptions, action, activeShortcutPlatform);
        const isCapturing = capturingShortcutAction === action;
        const conflicts = shortcutConflictMap[action];
        const conflictInfo = conflicts?.length ? splitConflictsByContext(conflicts) : null;
        return (
          <div
            key={action}
            style={{
              ...utilityPanelStyle,
              display: 'grid',
              gridTemplateColumns: '1fr auto',
              gap: 12,
              alignItems: 'center',
              padding: '10px 12px',
            }}
          >
            <div>
              <div style={{ fontWeight: 500 }}>{meta.label}</div>
              <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>{meta.description}</div>
              {conflictInfo && (
                <div style={{ fontSize: 11, color: darkMode ? '#faad14' : '#d48806', marginTop: 2 }}>
                  {conflictInfo.hasMonaco && (
                    <>⚠ {t('app.shortcuts.message.reserved_conflict_info', { labels: conflictInfo.monacoLabels })}</>
                  )}
                  {conflictInfo.hasOther && (
                    <>⚠ {t('app.shortcuts.message.reserved_conflict_warning', { contexts: conflictInfo.otherContexts, labels: conflictInfo.otherLabels })}</>
                  )}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Input
                readOnly
                value={isCapturing ? t('app.shortcuts.capture_waiting') : getShortcutDisplayLabel(binding.combo, activeShortcutPlatform)}
                style={{ width: 180, fontFamily: resolvedMonoFontFamily }}
              />
              <Button
                size="small"
                onClick={() => setCapturingShortcutAction((prev) => (prev === action ? null : action))}
              >
                {isCapturing ? t('common.cancel') : t('app.shortcuts.action.record')}
              </Button>
              <Switch
                checked={binding.enabled}
                onChange={(checked) => updateShortcut(action, { enabled: checked }, activeShortcutPlatform)}
              />
            </div>
          </div>
        );
      })}
    </div>
  </Modal>
);

export default ShortcutSettingsPane;
