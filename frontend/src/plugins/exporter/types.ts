import type { PluginState } from '../types';
export interface PluginExporterPin { readonly digest: string; readonly generation: number }
export interface PluginExporterDescriptor extends PluginExporterPin {
  readonly format: string; readonly pluginId: string; readonly id: string; readonly name: string;
  readonly extension: string; readonly contentType: string; readonly streaming: boolean; readonly version: string;
  readonly available: boolean; readonly state: PluginState; readonly reason?: string;
}
export interface PluginExporterCatalog { readonly items: readonly PluginExporterDescriptor[]; readonly truncated: boolean }
export type SnapshotValue = null | boolean | number | string | readonly SnapshotValue[] | { readonly [key: string]: SnapshotValue };
export interface FrozenExportSnapshot { readonly columns: readonly string[]; readonly rows: readonly Readonly<Record<string, SnapshotValue>>[] }
export interface PluginExportOperation { isCurrent: () => boolean; release: () => void }
export interface ConfirmedPluginExport { readonly format: string; readonly pin: PluginExporterPin; readonly snapshot: FrozenExportSnapshot; readonly operation: PluginExportOperation }
