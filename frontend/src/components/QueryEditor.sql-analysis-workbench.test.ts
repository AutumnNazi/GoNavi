import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('SQL analysis workbench wiring', () => {
  it('routes QueryEditor diagnose and slow-query actions to the sql-analysis workbench tab', () => {
    const source = readFileSync(new URL('./QueryEditor.tsx', import.meta.url), 'utf8')

    expect(source).toContain("buildSqlAnalysisWorkbenchTab")
    expect(source).toContain("openSqlAnalysisWorkbench('diagnose', getCurrentQuery())")
    expect(source).toContain("openSqlAnalysisWorkbench('slow-query')")
    expect(source).not.toContain('const [explainOpen, setExplainOpen]')
    expect(source).not.toContain('const [slowQueryOpen, setSlowQueryOpen]')
    expect(source).not.toContain('<ExplainWorkbench')
    expect(source).not.toContain('<SlowQueryPanel')
  })

  it('opens the same sql-analysis workbench from the sidebar slow-query button', () => {
    const source = readFileSync(new URL('./sidebar/SlowQueryRailButton.tsx', import.meta.url), 'utf8')

    expect(source).toContain('buildSqlAnalysisWorkbenchTab')
    expect(source).toContain("view: 'slow-query'")
    expect(source).not.toContain('SlowQueryPanel')
  })

  it('uses a compact segmented switcher in the sql-analysis workbench header', () => {
    const source = readFileSync(new URL('./explain/SqlAnalysisWorkbench.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Segmented')
    expect(source).toContain('gn-sql-analysis-view-switcher')
    expect(source).not.toContain('<Tabs')
  })

  it('uses a compact segmented switcher inside the explain report view', () => {
    const source = readFileSync(new URL('./explain/ExplainWorkbench.tsx', import.meta.url), 'utf8')

    expect(source).toContain('Segmented')
    expect(source).toContain('gn-explain-report-switcher')
    expect(source).not.toContain('<Tabs')
  })

  it('fills the SQL analysis report viewport through the Ant Spin wrapper', () => {
    const source = readFileSync(new URL('./explain/ExplainWorkbench.tsx', import.meta.url), 'utf8')

    expect(source).toContain('wrapperClassName="gn-explain-report-spinner"')
    expect(source).toMatch(
      /\.gn-explain-report-spinner > \.ant-spin-container \{[^}]*height: 100%;[^}]*min-height: 0;[^}]*display: flex;[^}]*flex-direction: column;/s,
    )
    expect(source).toMatch(
      /\.gn-explain-report-shell \{[^}]*flex: 1 1 auto;[^}]*min-height: 0;[^}]*display: flex;[^}]*flex-direction: column;/s,
    )
  })

  it('keeps the editor draft separate from the SQL submitted for diagnosis', () => {
    const source = readFileSync(new URL('./explain/SqlAnalysisWorkbench.tsx', import.meta.url), 'utf8')

    expect(source).toContain('submittedSql')
    expect(source).toContain('setSubmittedSql')
    expect(source).toContain('sql={submittedSql}')
    expect(source).toContain("event.key === 'Enter'")
    expect(source).toContain('event.ctrlKey || event.metaKey')
  })

  it('loads a slow query into the editor without immediately diagnosing it', () => {
    const source = readFileSync(new URL('./explain/SqlAnalysisWorkbench.tsx', import.meta.url), 'utf8')
    const handler = source.slice(source.indexOf('const handlePickSlowQuery'), source.indexOf('const slowQueryLoadKey'))

    expect(handler).toContain('setSqlDraft(nextSql)')
    expect(handler).toContain("setActiveView('diagnose')")
    expect(handler).toContain("setSubmittedSql('')")
    expect(handler).toContain('setDiagnoseRunKey(0)')
    expect(handler).not.toContain('setDiagnoseRunKey((previous)')
  })

  it('guards diagnose and slow-query responses against stale requests', () => {
    const explainSource = readFileSync(new URL('./explain/ExplainWorkbench.tsx', import.meta.url), 'utf8')
    const slowQuerySource = readFileSync(new URL('./explain/SlowQueryPanel.tsx', import.meta.url), 'utf8')

    expect(explainSource).toContain('requestSequenceRef')
    expect(slowQuerySource).toContain('requestSequenceRef')
  })

  it('disables execution-plan diagnosis for unsupported datasource types', () => {
    const capabilitiesSource = readFileSync(new URL('../utils/dataSourceCapabilities.ts', import.meta.url), 'utf8')
    const workbenchSource = readFileSync(new URL('./explain/SqlAnalysisWorkbench.tsx', import.meta.url), 'utf8')
    const queryEditorSource = readFileSync(new URL('./QueryEditor.tsx', import.meta.url), 'utf8')

    expect(capabilitiesSource).toContain('supportsExplainDiagnosis')
    expect(workbenchSource).toContain('disabled: !supportsDiagnosis')
    expect(workbenchSource).toContain("t('sql_analysis.slow_query.unsupported_diagnosis')")
    expect(queryEditorSource).toContain('!currentConnectionCapabilities.supportsExplainDiagnosis')
  })
})
