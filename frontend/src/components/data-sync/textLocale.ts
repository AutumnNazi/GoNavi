export type DataSyncWorkbenchLocale = 'zh-CN' | 'en-US';

export const resolveDataSyncWorkbenchLocale = (
  language?: string,
): DataSyncWorkbenchLocale =>
  String(language || '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
