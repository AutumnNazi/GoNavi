import { Table } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useMemo } from 'react'
import { useI18n } from '../../i18n/provider'
import { formatNumber, type ExplainNode } from '../../utils/explainTypes'
import { formatOperationLabel, resolveOperationColor } from './ExplainGraphNode'
import { localizeExplainFlag } from './ExplainSidebar'
import {
  buildExplainStepRows,
  explainHeatLevel,
  explainOperationKindKey,
  formatShare,
  type ExplainStepRow,
} from './explainPlanInsights'

interface ExplainStepTableProps {
  nodes: ExplainNode[]
  selectedNodeId?: string | null
  onSelectNode: (nodeId: string) => void
}

/** The plan as an indented list: easier than the graph for deep or wide plans. */
export default function ExplainStepTable({ nodes, selectedNodeId, onSelectNode }: ExplainStepTableProps) {
  const { language, t } = useI18n()
  const rows = useMemo(() => buildExplainStepRows(nodes), [nodes])
  const expandedKeys = useMemo(() => nodes.map((node) => node.id), [nodes])
  const columns: ColumnsType<ExplainStepRow> = [
    {
      title: t('sql_analysis.explain_steps.column.step'),
      key: 'step',
      render: (_value, { node }) => (
        <span
          className="gn-explain-step__op"
          style={{ color: resolveOperationColor(node.opType) }}
          title={(node.flags ?? []).map((flag) => localizeExplainFlag(String(flag), t)).join(', ') || undefined}
        >
          {node.opType !== 'OTHER' ? (
            <span className="gn-explain-node__kind">{t(explainOperationKindKey(node.opType))}</span>
          ) : null}
          {node.opDetail || formatOperationLabel(node.opType)}
        </span>
      ),
    },
    {
      title: t('sql_analysis.explain_steps.column.object'),
      key: 'object',
      width: 150,
      ellipsis: true,
      render: (_value, { node }) => (
        <code className="gn-explain-step__object">{[node.table, node.index].filter(Boolean).join(' · ')}</code>
      ),
    },
    {
      title: t('sql_analysis.explain_steps.column.rows'),
      key: 'rows',
      width: 90,
      align: 'right',
      render: (_value, { node }) => (node.estRows === undefined ? '' : formatNumber(node.estRows, language)),
    },
    {
      title: t('sql_analysis.explain_steps.column.share'),
      key: 'share',
      width: 130,
      render: (_value, { node }) => (node.costShare ? (
        <span className={`gn-explain-step__share gn-explain-step__share--${explainHeatLevel(node.costShare)}`}>
          <span className="gn-explain-node__share-track">
            <span className="gn-explain-node__share-fill" style={{ width: `${Math.max(2, node.costShare * 100)}%` }} />
          </span>
          {t('sql_analysis.explain_hotspot.share', { share: formatShare(node.costShare) })}
        </span>
      ) : null),
    },
  ]
  return (
    <Table<ExplainStepRow>
      className="gn-explain-steps"
      tableLayout="fixed"
      size="small"
      rowKey="key"
      pagination={false}
      columns={columns}
      dataSource={rows}
      expandable={{ defaultExpandedRowKeys: expandedKeys, indentSize: 18 }}
      rowClassName={(row) => (row.key === selectedNodeId ? 'gn-explain-step is-selected' : 'gn-explain-step')}
      onRow={(row) => ({ onClick: () => onSelectNode(row.key) })}
    />
  )
}
