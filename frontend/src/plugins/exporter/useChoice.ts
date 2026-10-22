import { useCallback, useEffect, useRef } from 'react';
import { usePluginExporterCatalog, type ExporterChoice } from './useCatalog';
import { isPluginExporterNamespace } from './identity';
import type { DataExportDialogValues } from '../../components/dataExportOptions';
export function useExporterChoice(enabled: boolean, values: DataExportDialogValues, change: (values: DataExportDialogValues) => void,
  registerGuard?: (guard: () => boolean) => void) {
  const catalog = usePluginExporterCatalog(enabled); const chosen = useRef<ExporterChoice | null>(null);
  const latest = useRef(values); latest.current = values;
  const isCurrent = useCallback(() => {
    const value = latest.current; const item = catalog.items.find((entry) => entry.format === value.format);
    return catalog.isCurrent(chosen.current) && value.pluginExporter?.digest === item?.digest && value.pluginExporter?.generation === item?.generation;
  }, [catalog.items, catalog.isCurrent]);
  useEffect(() => { registerGuard?.(isCurrent); }, [registerGuard, isCurrent]);
  const select = (format: string) => {
    if (!isPluginExporterNamespace(format)) { chosen.current = null; change({ ...latest.current, format, pluginExporter: undefined, confirmedPluginExport: undefined }); return; }
    const ticket = catalog.choose(format); const item = catalog.items.find((entry) => entry.format === format);
    if (!ticket || !item) return; chosen.current = ticket;
    change({ ...latest.current, format, pluginExporter: Object.freeze({ digest: item.digest, generation: item.generation }), confirmedPluginExport: undefined });
  };
  return { catalog, select, isCurrent };
}
