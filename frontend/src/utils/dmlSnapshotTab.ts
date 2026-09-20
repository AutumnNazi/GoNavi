import { t } from '../i18n';
import type { TabData } from '../types';

export const DML_SNAPSHOT_WORKBENCH_TAB_ID = 'dml-snapshot-center';

// 快照中心是全局只读视图：它跨越所有连接展示"执行前快照"，
// 因此不像审计中心那样绑定 connectionId —— 绑定反而会藏起其他连接的快照。
export const buildDMLSnapshotWorkbenchTab = (): TabData => ({
  id: DML_SNAPSHOT_WORKBENCH_TAB_ID,
  title: t('dml_snapshot.workbench.tab_title'),
  type: 'dml-snapshot',
  connectionId: '',
});
