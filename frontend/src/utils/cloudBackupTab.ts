import { t } from '../i18n';
import type { TabData } from '../types';

export const CLOUD_BACKUP_WORKBENCH_TAB_ID = 'cloud-backup-center';

// 云端备份是全局配置面板：配置作用于应用级备份通道，
// 与连接无关，因此不绑定 connectionId。
export const buildCloudBackupWorkbenchTab = (): TabData => ({
  id: CLOUD_BACKUP_WORKBENCH_TAB_ID,
  title: t('app.settings.entry.cloud_backup.title'),
  type: 'cloud-backup',
  connectionId: '',
});
