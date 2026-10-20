import { Select } from 'antd';
import { useI18n } from '../../i18n/provider';
import type { SQLAuditFilter } from '../audit/sqlAuditModel';

interface Props {
  filter: SQLAuditFilter;
  onFieldChange: <K extends keyof SQLAuditFilter>(key: K, value: SQLAuditFilter[K]) => void;
}

export default function QueryHistorySourceFilter({ filter, onFieldChange }: Props) {
  const { t } = useI18n();
  return <Select
    className="gn-qh-filter-source"
    aria-label={t('sql_audit.filter.source')}
    value={filter.includeMcp ? (filter.source || 'all') : 'query_editor'}
    options={[
      { value: 'query_editor', label: t('sql_audit.source.query_editor') },
      { value: 'mcp', label: t('sql_audit.source.mcp') },
      { value: 'all', label: t('sql_audit.mcp.history_all') },
    ]}
    onChange={(value) => {
      onFieldChange('includeMcp', value !== 'query_editor');
      onFieldChange('source', value === 'mcp' ? 'mcp' : '');
    }}
  />;
}
