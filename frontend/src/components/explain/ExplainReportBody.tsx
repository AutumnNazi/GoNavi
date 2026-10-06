import { useEffect, useState } from 'react'
import { ApartmentOutlined, CodeOutlined, UnorderedListOutlined } from '@ant-design/icons'
import { Segmented, Typography } from 'antd'
import { useI18n } from '../../i18n/provider'
import type { DiagnoseReport, ExplainNode, IndexSuggestion } from '../../utils/explainTypes'
import ExplainGraph from './ExplainGraph'
import ExplainHotspotStrip from './ExplainHotspotStrip'
import ExplainSidebar from './ExplainSidebar'
import ExplainStepTable from './ExplainStepTable'
import type { ExplainLayoutDirection } from './explainPlanInsights'

const { Text } = Typography

type ExplainReportViewMode = 'plan' | 'steps' | 'raw'

interface ExplainReportBodyProps {
  report: DiagnoseReport
  reportRevision: number
  selectedNodeId: string | null
  selectedNode?: ExplainNode
  onSelectNode: (nodeId: string | null) => void
  onSelectSuggestion: (suggestion: IndexSuggestion) => void
}

function ViewLabel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <span className="gn-explain-report-switcher-label">
      {icon}
      <span>{text}</span>
    </span>
  )
}

/** A loaded report: the view switcher, the hotspot strip, then the graph or step list with the sidebar, or the raw output. */
export default function ExplainReportBody({
  report,
  reportRevision,
  selectedNodeId,
  selectedNode,
  onSelectNode,
  onSelectSuggestion,
}: ExplainReportBodyProps) {
  const { t } = useI18n()
  const [activeView, setActiveView] = useState<ExplainReportViewMode>('plan')
  // The layout is a reading preference, so it survives re-running the diagnosis.
  const [direction, setDirection] = useState<ExplainLayoutDirection>('TB')

  useEffect(() => {
    setActiveView('plan')
  }, [report])

  return (
    <div className="gn-explain-report-shell">
      <div className="gn-explain-report-switcher-row">
        <Segmented
          value={activeView}
          onChange={(value) => setActiveView(value as ExplainReportViewMode)}
          className="gn-explain-report-switcher"
          options={[
            { value: 'plan', label: <ViewLabel icon={<ApartmentOutlined />} text={t('sql_analysis.explain.view.plan')} /> },
            { value: 'steps', label: <ViewLabel icon={<UnorderedListOutlined />} text={t('sql_analysis.explain.view.steps')} /> },
            { value: 'raw', label: <ViewLabel icon={<CodeOutlined />} text={t('sql_analysis.explain.view.raw')} /> },
          ]}
        />
        {activeView === 'plan' ? (
          <Segmented
            size="small"
            aria-label={t('sql_analysis.explain.layout.label')}
            value={direction}
            onChange={(value) => setDirection(value as ExplainLayoutDirection)}
            options={[
              { value: 'TB', label: t('sql_analysis.explain.layout.vertical') },
              { value: 'LR', label: t('sql_analysis.explain.layout.horizontal') },
            ]}
          />
        ) : null}
        <Text type="secondary" className="gn-explain-report-switcher-meta">
          {t('sql_analysis.explain.meta.node_count', { count: report.plan.nodes.length })}
          <span className="gn-explain-report-switcher-meta-separator">/</span>
          {report.plan.rawFormat}
        </Text>
      </div>

      {activeView !== 'raw' ? (
        <ExplainHotspotStrip
          nodes={report.plan.nodes}
          basis={report.plan.hotspotBasis}
          selectedNodeId={selectedNodeId}
          onSelectNode={onSelectNode}
        />
      ) : null}
      <div className="gn-explain-report-content">
        {activeView === 'raw' ? (
          <pre className="gn-explain-raw">{report.plan.rawPayload || t('sql_analysis.explain.raw.empty')}</pre>
        ) : (
          <div className="gn-explain-plan-view">
            <div className="gn-explain-plan-graph">
              {activeView === 'plan' ? (
                <ExplainGraph
                  key={reportRevision}
                  nodes={report.plan.nodes}
                  edges={report.plan.edges ?? []}
                  selectedNodeId={selectedNodeId ?? undefined}
                  onSelectNode={onSelectNode}
                  direction={direction}
                />
              ) : (
                <ExplainStepTable nodes={report.plan.nodes} selectedNodeId={selectedNodeId} onSelectNode={onSelectNode} />
              )}
            </div>
            <div className="gn-explain-plan-sidebar">
              <ExplainSidebar
                stats={report.plan.stats}
                warnings={report.plan.warnings}
                suggestions={report.suggestions ?? []}
                selectedNode={selectedNode}
                onSelectSuggestion={onSelectSuggestion}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
