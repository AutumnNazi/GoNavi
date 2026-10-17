import React from 'react';
import { Alert, Empty } from 'antd';
import type { TabData } from '../../types';
import { XxlJobGroupPanel } from './XxlJobGroupPanel';
import { XxlJobJobPanel } from './XxlJobJobPanel';
import { XxlJobLogPanel } from './XxlJobLogPanel';

type Props = {
  tab: TabData;
  isActive?: boolean;
};

// XXL-JOB 工作台壳：按标签页类型路由到执行器 / 任务 / 调度日志三个面板。
// 面板各自持有筛选与分页状态，切标签不会互相污染。
const XxlJobWorkbench: React.FC<Props> = ({ tab, isActive = true }) => {
  const panel = tab.xxlJobPanel
    ?? (tab.type === 'xxljob-jobs' ? 'jobs' : tab.type === 'xxljob-logs' ? 'logs' : 'groups');

  if (!tab.connectionId) {
    return <Alert type="error" showIcon message="XXL-JOB" />;
  }

  if (panel === 'jobs') {
    return <XxlJobJobPanel connectionId={tab.connectionId} isActive={isActive} />;
  }
  if (panel === 'logs') {
    return <XxlJobLogPanel connectionId={tab.connectionId} isActive={isActive} />;
  }
  if (panel === 'groups') {
    return <XxlJobGroupPanel connectionId={tab.connectionId} isActive={isActive} />;
  }
  return <Empty />;
};

export default XxlJobWorkbench;
