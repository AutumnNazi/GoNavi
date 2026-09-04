import { SettingOutlined } from '@ant-design/icons';
import { Button, Typography, theme } from 'antd';
import { useCallback, useEffect, useState } from 'react';
import { useI18n } from '../i18n/provider';
import { useStore } from '../store';
import type { TabData } from '../types';
import {
  DOWNLOAD_SOURCE_CHANGED_EVENT,
  requestDownloadSourceSettings,
  requestGlobalProxySettings,
} from '../utils/driverManagerTab';
import DriverManagerModal from './DriverManagerModal';
import './DriverManagerWorkbench.css';

const { Text, Title } = Typography;
type DownloadSourceId = 'cst' | 'bero' | 'github';

const normalizeDownloadSource = (value: unknown): DownloadSourceId => (
  value === 'bero' || value === 'github' ? value : 'cst'
);

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
  const [downloadSource, setDownloadSource] = useState<DownloadSourceId>('cst');
  const loadDownloadSource = useCallback(async () => {
    const backendApp = (window as any).go?.app?.App;
    if (typeof backendApp?.GetDownloadSourceConfig !== 'function') return;
    try {
      const result = await backendApp.GetDownloadSourceConfig();
      setDownloadSource(normalizeDownloadSource(result?.source));
    } catch (error) {
      console.warn('Failed to load download source preference in driver workbench', error);
    }
  }, []);

  useEffect(() => {
    if (isActive) void loadDownloadSource();
  }, [isActive, loadDownloadSource]);

  useEffect(() => {
    const handleDownloadSourceChanged = (event: Event) => {
      setDownloadSource(normalizeDownloadSource((event as CustomEvent<{ source?: unknown }>).detail?.source));
    };
    const handleWindowFocus = () => void loadDownloadSource();
    window.addEventListener(DOWNLOAD_SOURCE_CHANGED_EVENT, handleDownloadSourceChanged);
    window.addEventListener('focus', handleWindowFocus);
    return () => {
      window.removeEventListener(DOWNLOAD_SOURCE_CHANGED_EVENT, handleDownloadSourceChanged);
      window.removeEventListener('focus', handleWindowFocus);
    };
  }, [loadDownloadSource]);
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
        <div className="gn-driver-manager-workbench-source">
          <span className="gn-driver-manager-workbench-source-dot" data-download-source={downloadSource} aria-hidden="true" />
          <Text type="secondary">{t('driver_manager.mirror_source.label')}</Text>
          <Text strong>{t(`app.download_source.option.${downloadSource}`)}</Text>
          <Button size="small" onClick={requestDownloadSourceSettings}>
            {t('driver_manager.mirror_source.switch')}
          </Button>
        </div>
      </header>

      <section className="gn-driver-manager-workbench-content">
        <DriverManagerModal
          embedded
          open={isActive}
          onClose={() => (onRequestClose ? onRequestClose() : closeTab(tab.id))}
          onOpenGlobalProxySettings={requestGlobalProxySettings}
          onOpenDownloadSourceSettings={requestDownloadSourceSettings}
          downloadSource={downloadSource}
        />
      </section>
    </main>
  );
}
