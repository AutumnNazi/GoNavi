import { SettingOutlined } from '@ant-design/icons';
import { Typography, theme } from 'antd';
import { useI18n } from '../i18n/provider';
import { useStore } from '../store';
import type { TabData } from '../types';
import { requestGlobalProxySettings } from '../utils/driverManagerTab';
import DriverManagerModal from './DriverManagerModal';
import './DriverManagerWorkbench.css';

const { Text, Title } = Typography;

interface DriverManagerWorkbenchProps {
  tab: TabData;
  isActive?: boolean;
  onRequestClose?: () => void;
}

export default function DriverManagerWorkbench({
  tab,
  isActive = true,
  onRequestClose,
}: DriverManagerWorkbenchProps) {
  const { t } = useI18n();
  const { token } = theme.useToken();
  const closeTab = useStore((state) => state.closeTab);
  const workbenchStyle = {
    '--driver-manager-workbench-bg': token.colorBgLayout,
    '--driver-manager-workbench-text': token.colorText,
    '--driver-manager-workbench-subtle': token.colorFillQuaternary,
    '--driver-manager-workbench-primary': token.colorPrimary,
  } as React.CSSProperties;

  return (
    <main
      className="gn-driver-manager-workbench"
      style={workbenchStyle}
      aria-labelledby="driver-manager-workbench-title"
    >
      <header className="gn-driver-manager-workbench-header">
        <div className="gn-driver-manager-workbench-title-group">
          <div className="gn-driver-manager-workbench-title-icon" aria-hidden="true">
            <SettingOutlined />
          </div>
          <div className="gn-driver-manager-workbench-title-copy">
            <Title level={4} id="driver-manager-workbench-title">
              {t('driver_manager.title')}
            </Title>
            <Text type="secondary">{t('app.tools.entry.drivers.description')}</Text>
          </div>
        </div>
      </header>

      <section className="gn-driver-manager-workbench-content">
        <DriverManagerModal
          embedded
          open={isActive}
          onClose={() => (onRequestClose ? onRequestClose() : closeTab(tab.id))}
          onOpenGlobalProxySettings={requestGlobalProxySettings}
        />
      </section>
    </main>
  );
}
