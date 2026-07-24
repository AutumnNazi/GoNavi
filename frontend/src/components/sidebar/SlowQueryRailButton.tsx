import { useMemo } from 'react'
import { Tooltip } from 'antd'
import { HistoryOutlined } from '@ant-design/icons'
import { useStore } from '../../store'
import { useWorkbenchTabs } from '../../hooks/useWorkbenchTabs'
import { useI18n } from '../../i18n/provider'
import { buildSqlAnalysisWorkbenchTab } from '../../utils/sqlAnalysisTab'
import './SlowQueryRailButton.css'

// Sidebar 底部的慢 SQL 工作台入口。
//
// 设计要点：
//   - 完全独立组件，不依赖 Sidebar.tsx 内部 state（避免改 Sidebar Props）
//   - 自己从 store 读取 tabs/connections，定位当前激活 tab 的连接上下文
//   - 点击后打开/聚焦 SQL 分析工作台，并默认切到慢 SQL 视图
//   - 没有激活的连接时按钮禁用，hover 给提示
//
// 挂载位置：由调用方决定；当前用于 Sidebar 底部 footer。

interface SlowQueryRailButtonProps {
  /** 自定义 className 用于外层定位 */
  className?: string
  /** 自定义 style（用于绝对定位到 Sidebar 角落） */
  style?: React.CSSProperties
  /** tooltip 位置 */
  tooltipPlacement?:
    | 'top'
    | 'right'
    | 'bottom'
    | 'left'
    | 'topLeft'
    | 'topRight'
    | 'bottomLeft'
    | 'bottomRight'
    | 'leftTop'
    | 'leftBottom'
    | 'rightTop'
    | 'rightBottom'
}

export default function SlowQueryRailButton({
  className,
  style,
  tooltipPlacement = 'right',
}: SlowQueryRailButtonProps) {
  const { t } = useI18n()
  const tabs = useWorkbenchTabs()
  const activeTabId = useStore(s => s.activeTabId)
  const connections = useStore(s => s.connections)
  const addTab = useStore(s => s.addTab)

  const activeTab = useMemo(
    () => tabs.find(t => t.id === activeTabId) || null,
    [activeTabId, tabs],
  )
  const hasActiveConnection = useMemo(
    () =>
      Boolean(
        activeTab?.connectionId &&
        connections.some(connection => connection.id === activeTab.connectionId),
      ),
    [activeTab, connections],
  )

  const buttonDisabled = !hasActiveConnection
  const tooltipText = buttonDisabled
    ? t('sql_analysis.slow_query.rail.tooltip.no_connection')
    : t('sql_analysis.slow_query.rail.tooltip.open')

  return (
    <Tooltip title={tooltipText} placement={tooltipPlacement}>
      <button
        type="button"
        className={['gn-slow-query-rail-button', className].filter(Boolean).join(' ')}
        onClick={() => {
          if (buttonDisabled || !activeTab?.connectionId) {
            return
          }
          addTab(buildSqlAnalysisWorkbenchTab({
            connectionId: activeTab.connectionId,
            dbName: activeTab.dbName,
            view: 'slow-query',
          }))
        }}
        disabled={buttonDisabled}
        style={style}
        aria-label={t('sql_analysis.slow_query.rail.aria_label')}
        data-sidebar-sql-analysis-action="true"
      >
        <HistoryOutlined style={{ fontSize: 16 }} />
      </button>
    </Tooltip>
  )
}
