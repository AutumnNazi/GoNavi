import { useEffect } from 'react';

import { publishSqlExecutionLogOpen } from '../../utils/sqlExecutionLogVisibility';

interface QueryEditorSqlLogBridgeOptions {
  isActive: boolean;
  isOpen: boolean;
  onShow: (mode: 'open' | 'toggle') => void;
}

/**
 * 把活动查询页的 SQL 日志显隐同步出去，并接住标题栏/快捷键发出的打开事件。
 * 只有活动页发布状态，避免后台页把勾选盖掉。
 */
export function useQueryEditorSqlLogBridge({
  isActive,
  isOpen,
  onShow,
}: QueryEditorSqlLogBridgeOptions): void {
  useEffect(() => {
    if (!isActive) {
      publishSqlExecutionLogOpen(false);
      return;
    }
    publishSqlExecutionLogOpen(isOpen);
  }, [isActive, isOpen]);

  useEffect(() => {
    if (!isActive) {
      return;
    }
    return () => publishSqlExecutionLogOpen(false);
  }, [isActive]);

  useEffect(() => {
    const handleOpenSqlExecutionLog = (event: Event) => {
      const mode = event instanceof CustomEvent && event.detail?.mode === 'open' ? 'open' : 'toggle';
      onShow(mode);
    };

    window.addEventListener('gonavi:show-sql-execution-log', handleOpenSqlExecutionLog as EventListener);
    return () => {
      window.removeEventListener('gonavi:show-sql-execution-log', handleOpenSqlExecutionLog as EventListener);
    };
  }, [onShow]);
}
