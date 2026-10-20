import { Button, Input, Space } from 'antd';
import { useI18n } from '../../i18n/provider';
import type { SQLAuditFilter } from './sqlAuditModel';

interface Props {
  filter: SQLAuditFilter;
  onChange: <K extends keyof SQLAuditFilter>(key: K, value: SQLAuditFilter[K]) => void;
}

export default function MCPAuditFilters({ filter, onChange }: Props) {
  const { t } = useI18n();
  return <Space wrap>
    <Button type={filter.source === 'mcp' ? 'primary' : 'default'} onClick={() => onChange('source', filter.source === 'mcp' ? '' : 'mcp')}>
      {t('sql_audit.mcp.entry')}
    </Button>
    <Input value={filter.mcpRequestId || ''} allowClear aria-label={t('sql_audit.mcp.request_id')}
      placeholder={t('sql_audit.mcp.request_id')} onChange={(event) => onChange('mcpRequestId', event.target.value)} />
  </Space>;
}
