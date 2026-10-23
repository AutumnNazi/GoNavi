import { useEffect, useRef } from 'react';
import type { DataExportDialogValues } from '../../components/dataExportOptions';
import { freezeExportSnapshot } from './snapshot';
import { exporterError } from './validation';
interface Source { allowed: boolean; rows: readonly unknown[]; pageRows: readonly unknown[]; columns: readonly string[]; selectedKeys: readonly unknown[]; rowKey: string; keyString: (key: unknown) => string }
export function useSnapshotSource(source: Source) {
  const current = useRef({ source, revision: 0, alive: true });
  const previous = current.current.source;
  if (previous.rows !== source.rows || previous.columns !== source.columns || previous.pageRows !== source.pageRows || previous.selectedKeys !== source.selectedKeys || previous.allowed !== source.allowed) current.current.revision++;
  current.current.source = source;
  useEffect(() => { current.current.alive = true; return () => { current.current.alive = false; }; }, []);
  return () => {
    const revision = current.current.revision;
    return (values: DataExportDialogValues, streaming = false) => {
      if (!current.current.alive || current.current.revision !== revision) return exporterError('source_changed');
      const input = current.current.source;
      if (!input.allowed || !['selected', 'page'].includes(String(values.scope))) return exporterError('scope');
      const selected = new Set(input.selectedKeys.map(input.keyString));
      const rows = values.scope === 'page' ? input.pageRows : input.rows.filter((row) => {
        if (!row || typeof row !== 'object') return false;
        const key = Object.getOwnPropertyDescriptor(row, input.rowKey);
        return key && 'value' in key && ['string', 'number'].includes(typeof key.value) && selected.has(input.keyString(key.value));
      });
      if (values.scope === 'selected' && !rows.length) return exporterError('selection');
      return freezeExportSnapshot(values.format, rows, input.columns, values.columns, streaming);
    };
  };
}
