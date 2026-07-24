import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../i18n/provider';
import type { LanguagePreference } from '../../i18n/types';
import SqlAuditWorkbench from './SqlAuditWorkbench';

const connections = [{
  id: 'conn-1',
  name: 'orders-prod',
  config: { type: 'mysql', host: 'localhost', port: 3306 },
}];

vi.mock('../../store', () => ({
  useStore: (selector: (state: any) => unknown) => selector({ connections }),
}));

const renderWorkbench = (preference: LanguagePreference = 'en-US') => renderToStaticMarkup(
  <I18nProvider preference={preference} systemLanguages={[preference]} onPreferenceChange={vi.fn()}>
    <SqlAuditWorkbench
      tab={{ id: 'sql-audit-center', title: 'SQL Audit', type: 'sql-audit', connectionId: '' }}
      backend={{}}
    />
  </I18nProvider>,
);

describe('SqlAuditWorkbench', () => {
  it('renders a localized, privacy-first audit workspace empty state', () => {
    const markup = renderWorkbench('en-US');

    expect(markup).toContain('SQL Audit Center');
    expect(markup).toContain('Audit SQL is redacted by default');
    expect(markup).toContain('No SQL audit records yet');
    expect(markup).toContain('Search SQL, fingerprint, query ID, or error…');
    expect(markup).not.toContain('SQL 审计中心');
  });

  it('keeps large-record rendering server-paged and details outside variable-height rows', () => {
    const source = readFileSync(new URL('./SqlAuditWorkbench.tsx', import.meta.url), 'utf8');
    const detailSource = readFileSync(new URL('./SqlAuditDetailDrawer.tsx', import.meta.url), 'utf8');
    const styleSource = readFileSync(new URL('./SqlAuditWorkbench.css', import.meta.url), 'utf8');

    expect(source).toContain('pageSizeOptions={[25, 50]}');
    expect(source).toContain('pagination={false}');
    expect(source).toContain('getSQLAuditEventPreview(record)');
    expect(source).toContain('<SqlAuditDetailDrawer');
    expect(source).not.toContain('pageSizeOptions={[25, 50, 100');
    expect(detailSource).toContain('SQL_AUDIT_TIMELINE_PAGE_SIZE = 50');
    expect(detailSource).toContain('page: timelinePage');
    expect(detailSource).toContain('setTimelineTotal(page.total || 1)');
    expect(detailSource).toContain('setLoading(false)');
    expect(styleSource).toContain('overflow-y: auto;');
    expect(styleSource).toMatch(/\.gn-sql-audit-table-panel\s*\{[\s\S]*?min-height:\s*280px;/);
  });

  it('keeps the fixed action column opaque while rows are hovered', () => {
    const styleSource = readFileSync(new URL('./SqlAuditWorkbench.css', import.meta.url), 'utf8');

    expect(styleSource).toMatch(
      /\.gn-sql-audit-table-panel\s+\.ant-table-cell-fix-right[\s\S]*?background:\s*var\(--sql-audit-panel\)/,
    );
    expect(styleSource).toMatch(
      /\.gn-sql-audit-workbench\s+\.gn-sql-audit-table-panel[\s\S]*?tr:hover\s*>\s*td[\s\S]*?background:\s*color-mix\(in srgb, var\(--sql-audit-text\) 4\.5%, var\(--sql-audit-panel\)\)\s*!important/,
    );
  });

  it('debounces only free-text search before querying SQLite', () => {
    const source = readFileSync(new URL('./SqlAuditWorkbench.tsx', import.meta.url), 'utf8');

    expect(source).toContain('SQL_AUDIT_SEARCH_DEBOUNCE_MS = 250');
    expect(source).toContain('setDebouncedSearch(filter.search)');
    expect(source).toContain('search: debouncedSearch');
    expect(source).not.toContain('useDeferredValue');
  });

  it('uses desktop SaveFileDialog export and browser payload export on their respective runtimes', () => {
    const source = readFileSync(new URL('./SqlAuditWorkbench.tsx', import.meta.url), 'utf8');

    expect(source).toContain("__GONAVI_WEB_RUNTIME__?.buildType === 'web'");
    expect(source).toContain('backend.ExportSQLAuditFile(filterPayload, format)');
    expect(source).toContain("requireSQLAuditMethod(backend, 'BuildSQLAuditExport')");
    expect(source).toContain('downloadBrowserTextFile(content, fileName, mimeType)');
    expect(source).toContain("cancellationMessage === 'cancelled'");
  });

  it('describes hash-chain verification as a consistency check rather than tamper proofing', () => {
    const source = readFileSync(new URL('./SqlAuditWorkbench.tsx', import.meta.url), 'utf8');

    expect(source).toContain('data.weakValidation === true');
    expect(source).toContain("t('sql_audit.integrity.weak_validation')");
    expect(source).toContain('data.partialChain === true || data.truncatedPrefix === true');
    expect(source).toContain("t('sql_audit.integrity.partial_chain')");
  });

  it('loads writer health on workbench load and explicit refresh without calling it integrity', () => {
    const source = readFileSync(new URL('./SqlAuditWorkbench.tsx', import.meta.url), 'utf8');
    const healthSource = readFileSync(new URL('./SqlAuditHealthAlert.tsx', import.meta.url), 'utf8');

    expect(source).toContain('<SqlAuditHealthAlert backend={backend} refreshKey={reloadKey} isActive={isActive} />');
    expect(healthSource).toContain("requireSQLAuditMethod(backend, 'GetSQLAuditHealth')");
    expect(healthSource).toContain('SQL_AUDIT_HEALTH_POLL_INTERVAL_MS = 30_000');
    expect(healthSource).toContain("getSQLAuditHealthPhase(health)");
    expect(healthSource).toContain("phase === 'degraded' || phase === 'historical_gap'");
  });

  it('never offers raw or full SQL capture modes', () => {
    const source = readFileSync(new URL('./SqlAuditSettingsDrawer.tsx', import.meta.url), 'utf8');

    expect(source).toContain("value: 'redacted'");
    expect(source).toContain("value: 'metadata'");
    expect(source).not.toContain("value: 'raw'");
    expect(source).not.toContain("value: 'full'");
  });

  it('does not allow failed settings loads to overwrite persisted configuration', () => {
    const source = readFileSync(new URL('./SqlAuditSettingsDrawer.tsx', import.meta.url), 'utf8');

    expect(source).toContain('setSettingsReady(false)');
    expect(source).toContain('disabled={!settingsReady || loading}');
    expect(source).toContain('if (!settingsReady || loading) return;');
    expect(source).not.toContain('form.setFieldsValue(DEFAULT_SQL_AUDIT_SETTINGS)');
  });
});
