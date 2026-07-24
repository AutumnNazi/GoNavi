import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const readSource = (fileName: string): string => (
  readFileSync(new URL(`./${fileName}`, import.meta.url), 'utf8')
);

describe('workspace heavy module loading', () => {
  it('keeps the loading fallback inside the full available content area', () => {
    const source = readSource('DeferredWorkspaceContentFallback.tsx');

    expect(source).toContain('aria-busy="true"');
    expect(source).toContain("flex: '1 1 auto'");
    expect(source).toContain('minHeight: 0');
    expect(source).toContain('minWidth: 0');
    expect(source).toContain('<Spin size="small" />');
  });

  it('keeps floating query results from loading DataGrid before a result window exists', () => {
    const source = readSource('FloatingQueryResultWindows.tsx');

    expect(source).not.toMatch(/import\s+DataGrid\s+from\s+['"]\.\/DataGrid['"]/);
    expect(source).toContain("const createLazyDetachedResultDataGrid = () => React.lazy(() => import('./DataGrid'));");
    expect(source).toContain('const DeferredDetachedResultDataGrid: React.FC<DeferredDetachedResultDataGridProps>');
    expect(source).toContain('const [renderNonce, setRenderNonce] = useState(0);');
    expect(source).toContain('useMemo(createLazyDetachedResultDataGrid, [renderNonce])');
    expect(source).toContain('<DeferredWorkspaceContentErrorBoundary');
    expect(source).toContain('key={renderNonce} onRetry={retry}');
    expect(source).toContain('<React.Suspense fallback={<DeferredWorkspaceContentFallback />}>');
    expect(source).toContain('<LazyDataGrid');
    expect(source).toContain('<DeferredDetachedResultDataGrid');
    expect(source).not.toContain('detachedResultRenderNonce');
  });

  it('keeps existing workbench hosts stable instead of remounting healthy sibling tabs on retry', () => {
    for (const fileName of ['FloatingWorkbenchWindows.tsx', 'TabManager.tsx']) {
      const source = readSource(fileName);
      expect(source).toContain("import WorkbenchTabContent from './WorkbenchTabContent';");
      expect(source).toContain('<WorkbenchTabContent');
      expect(source).not.toContain('WorkbenchRenderNonce');
      expect(source).not.toContain("React.lazy(() => import('./WorkbenchTabContent'))");
    }
  });
});
