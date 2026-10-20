import { Alert } from 'antd';

export default function MCPAuditNotice({ translate: t }: { translate: (key: string) => string }) {
  return <Alert type="info" showIcon message={t('sql_audit.mcp.entry')} description={t('sql_audit.mcp.location')} />;
}
