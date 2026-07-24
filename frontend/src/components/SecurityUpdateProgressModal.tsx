import Modal from './common/ResizableDraggableModal';
import { Spin } from 'antd';
import { SafetyCertificateOutlined } from '@ant-design/icons';

import type { OverlayWorkbenchTheme } from '../utils/overlayWorkbenchTheme';
import {
  SECURITY_UPDATE_MODAL_CLASS,
  getSecurityUpdateShellSurfaceStyle,
} from '../utils/securityUpdateVisuals';
import { useI18n } from '../i18n/provider';
import { APP_NESTED_MODAL_Z_INDEX } from '../utils/overlayZIndex';

interface SecurityUpdateProgressModalProps {
  open: boolean;
  zIndex?: number;
  stageText: string;
  detailText?: string;
  overlayTheme: OverlayWorkbenchTheme;
  surfaceOpacity?: number;
}

const SecurityUpdateProgressModal = ({
  open,
  zIndex = APP_NESTED_MODAL_Z_INDEX,
  stageText,
  detailText,
  overlayTheme,
  surfaceOpacity = 1,
}: SecurityUpdateProgressModalProps) => {
  const { t } = useI18n();

  return (
    <Modal
      rootClassName={SECURITY_UPDATE_MODAL_CLASS}
      open={open}
      zIndex={zIndex}
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={null}
      width={420}
      centered
      styles={{
        content: getSecurityUpdateShellSurfaceStyle(overlayTheme, surfaceOpacity),
        header: { display: 'none' },
        body: { padding: 28 },
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 16 }}>
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: 18,
            display: 'grid',
            placeItems: 'center',
            background: overlayTheme.iconBg,
            color: overlayTheme.iconColor,
            fontSize: 22,
          }}
        >
          <SafetyCertificateOutlined />
        </div>
        <div style={{ fontSize: 16, fontWeight: 700, color: overlayTheme.titleText }}>
          {stageText}
        </div>
        <div style={{ fontSize: 13, color: overlayTheme.mutedText, lineHeight: 1.7 }}>
          {detailText ?? t('security_update.progress.default_detail')}
        </div>
        <Spin size="large" />
      </div>
    </Modal>
  );
};

export type { SecurityUpdateProgressModalProps };
export default SecurityUpdateProgressModal;
