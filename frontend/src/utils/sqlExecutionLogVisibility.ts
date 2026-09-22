import { useSyncExternalStore } from 'react';

type SqlExecutionLogListener = (open: boolean) => void;

let sqlExecutionLogOpen = false;
const listeners = new Set<SqlExecutionLogListener>();

/** 当前查询页是否正在显示 SQL 执行日志。没有查询页时为 false。 */
export const getSqlExecutionLogOpen = (): boolean => sqlExecutionLogOpen;

export const publishSqlExecutionLogOpen = (open: boolean): void => {
  if (sqlExecutionLogOpen === open) {
    return;
  }
  sqlExecutionLogOpen = open;
  listeners.forEach((listener) => listener(open));
};

export const subscribeSqlExecutionLogOpen = (listener: SqlExecutionLogListener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function useSqlExecutionLogOpen(): boolean {
  return useSyncExternalStore(subscribeSqlExecutionLogOpen, getSqlExecutionLogOpen, () => false);
}

/** 测试隔离用。生产路径不要调用。 */
export const resetSqlExecutionLogOpenForTests = (): void => {
  sqlExecutionLogOpen = false;
  listeners.clear();
};
