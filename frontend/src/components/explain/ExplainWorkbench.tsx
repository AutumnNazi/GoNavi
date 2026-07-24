import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ApartmentOutlined, CodeOutlined } from '@ant-design/icons'
import { Alert, Button, Empty, Segmented, Spin, Typography, theme } from 'antd'
import Modal from '../common/ResizableDraggableModal'
import { DiagnoseQuery } from '../../../wailsjs/go/app/App'
import { buildRpcConnectionConfig } from '../../utils/connectionRpcConfig'
import { useI18n } from '../../i18n/provider'
import type { ConnectionConfig } from '../../types'
import type { DiagnoseReport, ExplainNode, IndexSuggestion } from '../../utils/explainTypes'
import ExplainGraph from './ExplainGraph'
import ExplainSidebar from './ExplainSidebar'

// SQL 诊断工作台主容器。
// 通过 React.lazy 在 QueryEditor 触发"诊断"时延迟加载（避免 react-flow 进入主 bundle）。
//
// UI 结构：
//   ┌─────────────────────────────────────────────────┐
//   │  Modal：诊断工作台                              │
//   ├──────────────────────────────┬──────────────────┤
//   │  react-flow 执行计划图       │  侧栏            │
//   │  （点击节点联动）             │  - 统计条        │
//   │                              │  - 节点详情      │
//   │                              │  - 索引建议      │
//   └──────────────────────────────┴──────────────────┘
//   底部 tab：执行计划 | 原文（调试用）

const { Title, Text } = Typography

interface ExplainWorkbenchProps {
  open: boolean
  onClose: () => void
  config: ConnectionConfig
  dbName: string
  sql: string
}

interface ExplainReportViewProps {
  config: ConnectionConfig
  dbName: string
  sql: string
  runKey?: string | number | null
}

export function ExplainReportView({ config, dbName, sql, runKey }: ExplainReportViewProps) {
  const { t } = useI18n()
  const { token } = theme.useToken()
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<DiagnoseReport | null>(null)
  const [reportRevision, setReportRevision] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'plan' | 'raw'>('plan')
  const hasRequestedRun = runKey !== null && runKey !== undefined && runKey !== ''
  const requestSequenceRef = useRef(0)
  const requestInputRef = useRef({ config, dbName, sql, t })
  requestInputRef.current = { config, dbName, sql, t }

  const runDiagnose = useCallback(async () => {
    const currentInput = requestInputRef.current
    const requestSequence = ++requestSequenceRef.current
    if (!currentInput.sql.trim()) {
      setError(currentInput.t('sql_analysis.explain.error.query_required'))
      return
    }
    setLoading(true)
    setError(null)
    setSelectedNodeId(null)
    try {
      const result = await DiagnoseQuery(
        buildRpcConnectionConfig(currentInput.config),
        currentInput.dbName,
        currentInput.sql,
      )
      if (requestSequence !== requestSequenceRef.current) return
      if (!result.success) {
        setError(result.message || currentInput.t('sql_analysis.explain.error.run_failed'))
      } else {
        const data = result.data as DiagnoseReport
        setReport(data)
        setReportRevision((revision) => revision + 1)
      }
    } catch (cause) {
      if (requestSequence === requestSequenceRef.current) {
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    } finally {
      if (requestSequence === requestSequenceRef.current) {
        setLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    if (!hasRequestedRun) {
      return
    }
    void runDiagnose()
  }, [hasRequestedRun, runDiagnose, runKey])

  useEffect(() => () => {
    requestSequenceRef.current += 1
  }, [])

  useEffect(() => {
    if (report) {
      setActiveView('plan')
    }
  }, [report])

  const selectedNode = useMemo<ExplainNode | undefined>(() => {
    if (!report || !selectedNodeId) return undefined
    return report.plan.nodes.find((n) => n.id === selectedNodeId)
  }, [report, selectedNodeId])

  const handleSelectSuggestion = useCallback((s: IndexSuggestion) => {
    if (s.affectedNodeId) {
      setSelectedNodeId(s.affectedNodeId)
    }
  }, [])

  const reportStyle = {
    '--gn-fg-1': token.colorText,
    '--gn-fg-2': token.colorText,
    '--gn-fg-3': token.colorTextSecondary,
    '--gn-fg-4': token.colorTextTertiary,
    '--gn-fg-5': token.colorTextQuaternary,
    '--gn-bg-panel': token.colorBgContainer,
    '--gn-bg-panel-2': token.colorFillQuaternary,
    '--gn-bg-input': token.colorBgContainer,
    '--gn-bg-hover': token.colorFillTertiary,
    '--gn-bg-selected': token.colorPrimaryBg,
    '--gn-br-1': token.colorBorderSecondary,
    '--gn-br-2': token.colorBorder,
    '--gn-br-3': token.colorBorder,
    '--gn-shadow-sm': token.boxShadowTertiary,
    '--gn-shadow-md': token.boxShadowSecondary,
    '--gn-accent': token.colorPrimary,
    '--gn-accent-soft': token.colorPrimaryBg,
    '--gn-danger': token.colorError,
    '--gn-warn': token.colorWarning,
    '--gn-warn-soft': token.colorWarningBg,
    '--gn-info': token.colorInfo,
    '--gn-info-soft': token.colorInfoBg,
    '--gn-font-mono': token.fontFamilyCode,
  } as CSSProperties

  return (
    <div className="gn-explain-report-view" style={reportStyle}>
      <style>{reportViewStyles}</style>
      {loading && !report && (
        <div style={{ textAlign: 'center', padding: '60px 0' }}>
          <Spin tip={t('sql_analysis.explain.loading')} />
        </div>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message={t('sql_analysis.explain.error.title')}
          description={error}
          action={<Button size="small" onClick={() => void runDiagnose()}>{t('sql_analysis.explain.action.retry')}</Button>}
          style={{ marginBottom: 12 }}
        />
      )}
      {!loading && !error && !report && !hasRequestedRun && (
        <Empty description={t('sql_analysis.explain.empty')} style={{ padding: '48px 0' }} />
      )}
      {!error && report && (
        <Spin spinning={loading} tip={t('sql_analysis.explain.loading')} wrapperClassName="gn-explain-report-spinner">
          <div className="gn-explain-report-shell">
          <div className="gn-explain-report-switcher-row">
            <Segmented
              value={activeView}
              onChange={(value) => setActiveView(value as 'plan' | 'raw')}
              className="gn-explain-report-switcher"
              options={[
                {
                  value: 'plan',
                  label: (
                    <span className="gn-explain-report-switcher-label">
                      <ApartmentOutlined />
                      <span>{t('sql_analysis.explain.view.plan')}</span>
                    </span>
                  ),
                },
                {
                  value: 'raw',
                  label: (
                    <span className="gn-explain-report-switcher-label">
                      <CodeOutlined />
                      <span>{t('sql_analysis.explain.view.raw')}</span>
                    </span>
                  ),
                },
              ]}
            />
            <Text type="secondary" className="gn-explain-report-switcher-meta">
              {t('sql_analysis.explain.meta.node_count', { count: report.plan.nodes.length })}
              <span className="gn-explain-report-switcher-meta-separator">/</span>
              {report.plan.rawFormat}
            </Text>
          </div>

          <div className="gn-explain-report-content">
            {activeView === 'plan' ? (
              <div className="gn-explain-plan-view">
                <div className="gn-explain-plan-graph">
                  <ExplainGraph
                    key={reportRevision}
                    nodes={report.plan.nodes}
                    edges={report.plan.edges ?? []}
                    selectedNodeId={selectedNodeId ?? undefined}
                    onSelectNode={setSelectedNodeId}
                  />
                </div>
                <div className="gn-explain-plan-sidebar">
                  <ExplainSidebar
                    stats={report.plan.stats}
                    warnings={report.plan.warnings}
                    suggestions={report.suggestions ?? []}
                    selectedNode={selectedNode}
                    onSelectSuggestion={handleSelectSuggestion}
                  />
                </div>
              </div>
            ) : (
              <pre
                style={{
                  height: '100%',
                  margin: 0,
                  overflow: 'auto',
                  background: 'var(--gn-bg-panel-2, #f8fafc)',
                  color: 'var(--gn-fg-1, #111827)',
                  padding: 12,
                  borderRadius: 4,
                  fontSize: 12,
                  fontFamily: 'ui-monospace, Consolas, monospace',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  boxSizing: 'border-box',
                }}
              >
                {report.plan.rawPayload || t('sql_analysis.explain.raw.empty')}
              </pre>
            )}
          </div>
          </div>
        </Spin>
      )}
    </div>
  )
}

export default function ExplainWorkbench({ open, onClose, config, dbName, sql }: ExplainWorkbenchProps) {
  const { t } = useI18n()
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="90%"
      style={{ top: 20 }}
      title={<Title level={5} style={{ margin: 0 }}>{t('sql_analysis.workbench.title')}</Title>}
      destroyOnClose
    >
      <div style={{ minHeight: 480, height: '70vh' }}>
        <ExplainReportView
          config={config}
          dbName={dbName}
          sql={sql}
          runKey={open ? `${dbName}::${sql}` : null}
        />
      </div>
    </Modal>
  )
}

const reportViewStyles = `
  .gn-explain-report-view {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .gn-explain-report-shell {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .gn-explain-report-spinner {
    flex: 1 1 auto;
    min-height: 0;
  }
  .gn-explain-report-spinner > .ant-spin-container {
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .gn-explain-report-switcher-row {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
    flex-wrap: wrap;
  }
  .gn-explain-report-switcher {
    flex: 0 0 auto;
  }
  .gn-explain-report-switcher-label {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 88px;
    white-space: nowrap;
  }
  .gn-explain-report-switcher .ant-segmented-group {
    display: inline-flex;
    align-items: center;
  }
  .gn-explain-report-switcher .ant-segmented-item {
    min-height: 30px;
  }
  .gn-explain-report-switcher .ant-segmented-item-label {
    padding: 5px 12px;
    font-size: 13px;
    line-height: 20px;
  }
  .gn-explain-report-switcher-meta {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .gn-explain-report-switcher-meta-separator {
    display: inline-block;
    margin: 0 6px;
  }
  .gn-explain-report-content {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .gn-explain-plan-view {
    height: 100%;
    min-height: 0;
    display: flex;
    gap: 12px;
  }
  .gn-explain-plan-graph {
    flex: 1 1 auto;
    min-width: 320px;
    min-height: 0;
    position: relative;
  }
  .gn-explain-plan-sidebar {
    width: 320px;
    flex: 0 0 320px;
    min-height: 0;
    overflow-y: auto;
  }
  @media (max-width: 900px) {
    .gn-explain-plan-view {
      flex-direction: column;
      overflow-y: auto;
    }
    .gn-explain-plan-graph {
      width: 100%;
      min-width: 0;
      min-height: 360px;
      flex: 0 0 min(55vh, 480px);
    }
    .gn-explain-plan-sidebar {
      width: 100%;
      flex: 0 0 auto;
      overflow: visible;
    }
  }
`
