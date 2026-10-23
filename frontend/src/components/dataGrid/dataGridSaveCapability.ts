import type { ConnectionConfig } from '../../types';
import { pluginDataSourceConfigType } from '../../plugins/dataSource/identity';
import { isNavicatHttpTunnelConnection } from '../../utils/navicatHttpTunnel';

export type DataGridSaveCapability =
  | { supported: true }
  | { supported: false; messageKey: 'data_grid.message.navicat_http_tunnel_save_unsupported' | 'plugin.datasource.read_only' };

export const getDataGridSaveCapability = (
  config: ConnectionConfig | null | undefined,
): DataGridSaveCapability => (
  pluginDataSourceConfigType(config) ? { supported: false, messageKey: 'plugin.datasource.read_only' } : isNavicatHttpTunnelConnection(config)
    ? { supported: false, messageKey: 'data_grid.message.navicat_http_tunnel_save_unsupported' }
    : { supported: true }
);
