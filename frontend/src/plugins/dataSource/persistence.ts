import { isPluginDataSourceNamespace } from './identity';

// Keep explicit transport intent so the host can reject it; never turn TLS into plaintext.
export function pluginDataSourcePersistenceOverrides(raw: Record<string, unknown>): Record<string, unknown> {
  if (!isPluginDataSourceNamespace(raw.type)) return {};
  const text = (key: string) => typeof raw[key] === 'string' ? raw[key] : '';
  const port = Number(raw.port ?? 0);
  return { type: raw.type, host: text('host'), port: Number.isInteger(port) && port >= 0 && port <= 65535 ? port : 0,
    user: text('user'), password: raw.savePassword === false ? '' : text('password'),
    useSSL: raw.useSSL === true, sslMode: raw.sslMode == null ? 'disable' : raw.sslMode,
    sslCAPath: text('sslCAPath'), sslCertPath: text('sslCertPath'), sslKeyPath: text('sslKeyPath'),
    useSSH: raw.useSSH === true, useProxy: raw.useProxy === true, useHttpTunnel: raw.useHttpTunnel === true,
    hosts: raw.hosts, topology: raw.topology, keepAliveSQL: text('keepAliveSQL'),
    readOnly: raw.readOnly === true, pluginWritable: raw.pluginWritable === true,
    protection: raw.protection };
}
