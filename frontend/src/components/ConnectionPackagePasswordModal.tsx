import Modal from './common/ResizableDraggableModal';
import React from 'react';
import { Button, Checkbox, Input, Typography } from 'antd';
import { useI18n } from '../i18n/provider';

const { Text } = Typography;

type ConnectionPackagePasswordModalMode = 'import' | 'export';

export interface ConnectionPackagePasswordModalProps {
  open: boolean;
  title: string;
  mode?: ConnectionPackagePasswordModalMode;
  includeSecrets?: boolean;
  useFilePassword?: boolean;
  password: string;
  error?: string;
  confirmLoading?: boolean;
  confirmText?: string;
  cancelText?: string;
  onBack?: () => void;
  embedded?: boolean;
  onIncludeSecretsChange?: (value: boolean) => void;
  onUseFilePasswordChange?: (value: boolean) => void;
  onPasswordChange: (value: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConnectionPackagePasswordModal({
  open,
  title,
  mode = 'import',
  includeSecrets = true,
  useFilePassword = false,
  password,
  error,
  confirmLoading,
  confirmText,
  cancelText,
  onBack,
  embedded = false,
  onIncludeSecretsChange,
  onUseFilePasswordChange,
  onPasswordChange,
  onConfirm,
  onCancel,
}: ConnectionPackagePasswordModalProps) {
  const { t } = useI18n();
  const isExportMode = mode === 'export';
  const showFilePasswordInput = isExportMode ? useFilePassword : true;
  const resolvedConfirmText = confirmText ?? t('common.confirm');
  const resolvedCancelText = cancelText ?? t('common.cancel');
  const placeholder = isExportMode
    ? t('app.connection_package.dialog.file_password_placeholder')
    : t('app.connection_package.dialog.restore_password_placeholder');
  const helperText = !includeSecrets
    ? t('app.connection_package.dialog.help.exclude_passwords')
    : (useFilePassword
      ? t('app.connection_package.dialog.help.share_file_password_separately')
      : t('app.connection_package.dialog.help.encrypted_passwords_recommend_file_password'));

  return (
    <Modal
      open={open}
      embedded={embedded}
      title={embedded ? null : (
        <span style={{ minWidth: 0 }}>{title}</span>
      )}
      closable={embedded ? false : undefined}
      onCancel={onCancel}
      destroyOnHidden={false}
      maskClosable={false}
      footer={[
        onBack ? (
          <Button key="back" onClick={onBack}>
            {t(embedded ? 'common.back_to_settings' : 'common.back_to_previous')}
          </Button>
        ) : null,
        <Button key="cancel" onClick={onCancel}>
          {resolvedCancelText}
        </Button>,
        <Button key="confirm" type="primary" loading={confirmLoading} onClick={onConfirm}>
          {resolvedConfirmText}
        </Button>,
      ]}
    >
      {isExportMode ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Checkbox
            checked={includeSecrets}
            onChange={(event) => onIncludeSecretsChange?.(event.target.checked)}
          >
            {t('app.connection_package.dialog.option.include_passwords')}
          </Checkbox>
          <Checkbox
            checked={useFilePassword}
            disabled={!includeSecrets}
            onChange={(event) => onUseFilePasswordChange?.(event.target.checked)}
          >
            {t('app.connection_package.dialog.option.use_file_password')}
          </Checkbox>
        </div>
      ) : null}
      {showFilePasswordInput ? (
        <Input.Password
          autoFocus
          value={password}
          placeholder={placeholder}
          disabled={isExportMode && !useFilePassword}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      ) : null}
      {isExportMode ? (
        <Text type={useFilePassword ? 'warning' : 'secondary'} style={{ display: 'block', marginTop: 8 }}>
          {helperText}
        </Text>
      ) : null}
      {error ? (
        <Text type="danger" style={{ display: 'block', marginTop: 8 }}>
          {error}
        </Text>
      ) : null}
    </Modal>
  );
}
