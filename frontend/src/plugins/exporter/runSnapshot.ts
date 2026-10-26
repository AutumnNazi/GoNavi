import { ExportDataWithOptions } from '../../../wailsjs/go/app/App';
import type { DataExportFileOptions } from '../../components/dataExportOptions';
import type { ExportRunResult, RunExportWithProgressOptions } from '../../components/useExportProgressRunner';
import { isPluginExporterNamespace, parsePluginExporterFormat } from './identity';
import { validExporterPin, exporterError } from './validation';
import { safePluginExportResult } from './result';
export type SnapshotProgressRunner = (options: RunExportWithProgressOptions<ExportRunResult>) => Promise<ExportRunResult | null>;
export async function runPluginSnapshotExport(options: DataExportFileOptions, targetName: string, title: string, run: SnapshotProgressRunner): Promise<void> {
  const confirmed = options.confirmedPluginExport;
  try {
    if (!isPluginExporterNamespace(options.format) || !parsePluginExporterFormat(options.format) || !validExporterPin(options.pluginExporter)
      || !confirmed || confirmed.format !== options.format || confirmed.pin.digest !== options.pluginExporter.digest || confirmed.pin.generation !== options.pluginExporter.generation
      || !confirmed.operation.isCurrent() || JSON.stringify(options.columns) !== JSON.stringify(confirmed.snapshot.columns)) return exporterError('selection');
    await run({ title, targetName, format: options.format, totalRows: confirmed.snapshot.rows.length,
      shouldPublishResult: confirmed.operation.isCurrent,
      run: async (jobId) => {
        if (!confirmed.operation.isCurrent()) return exporterError('unavailable');
        const result = await ExportDataWithOptions([...confirmed.snapshot.rows], [...confirmed.snapshot.columns], targetName, {
          format: confirmed.format, columns: [...confirmed.snapshot.columns], pluginExporter: { ...confirmed.pin }, jobId,
          totalRowsHint: confirmed.snapshot.rows.length, totalRowsKnown: true,
        } as Parameters<typeof ExportDataWithOptions>[3]);
        return safePluginExportResult(result);
      },
    });
  } finally { confirmed?.operation.release(); }
}
