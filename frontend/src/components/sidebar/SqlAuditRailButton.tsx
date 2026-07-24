import { Tooltip } from 'antd';
import { AuditOutlined } from '@ant-design/icons';
import { useI18n } from '../../i18n/provider';
import { useStore } from '../../store';
import { buildSqlAuditWorkbenchTab } from '../../utils/sqlAuditTab';
import './SqlAuditRailButton.css';

interface SqlAuditRailButtonProps {
  className?: string;
  tooltipPlacement?: 'top' | 'right' | 'bottom' | 'left';
}

export default function SqlAuditRailButton({
  className,
  tooltipPlacement = 'top',
}: SqlAuditRailButtonProps) {
  const { t } = useI18n();
  const addTab = useStore((state) => state.addTab);

  return (
    <Tooltip title={t('sql_audit.rail.tooltip')} placement={tooltipPlacement}>
      <button
        type="button"
        className={['gn-sql-audit-rail-button', className].filter(Boolean).join(' ')}
        onClick={() => addTab(buildSqlAuditWorkbenchTab())}
        aria-label={t('sql_audit.rail.aria_label')}
        data-sidebar-sql-audit-action="true"
      >
        <AuditOutlined aria-hidden="true" />
      </button>
    </Tooltip>
  );
}
