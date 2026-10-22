import type { PluginDataSourceIdentity } from './identity';
export interface PluginDataSourceDescriptor extends PluginDataSourceIdentity {
  name: string;
  defaultPort: number;
  version: string;
  generation: number;
  available: boolean;
  connectable: boolean;
  state: 'disabled' | 'starting' | 'running' | 'stopping' | 'faulted' | 'blocked';
  readOnly: boolean;
  reason?: string;
}
export interface PluginDataSourceSnapshot {
  readonly items: readonly Readonly<PluginDataSourceDescriptor>[];
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: string;
  readonly revision: number;
}
