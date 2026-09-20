import { CopyOutlined } from '@ant-design/icons';
import { t } from '../../i18n';

export const buildSidebarCopyObjectNameMenuItem = (
  node: any,
  handleCopyTableName: (node: any) => void,
  key: string,
) => ({
  key,
  label: t('sidebar.menu.copy_object_name'),
  icon: <CopyOutlined />,
  onClick: () => handleCopyTableName(node),
});
