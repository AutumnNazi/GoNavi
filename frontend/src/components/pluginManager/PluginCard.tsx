import { Alert, Button, Tag, Typography } from 'antd';
import { useI18n } from '../../i18n/provider';
import type { PluginStatus } from '../../plugins/types';
import type { PluginManagerState } from '../../plugins/usePluginManager';
import { PluginLifecycleControls } from './PluginLifecycleControls';
import { PluginCommandsPanel } from './PluginCommandsPanel';
import { PluginDataSourceSummary } from './PluginDataSourceSummary';
import { PluginAIProviderSummary } from './PluginAIProviderSummary';
import { PluginExporterSummary } from './PluginExporterSummary';
import { PluginSkillSummary } from './PluginSkillSummary';
import { publicPluginCommands } from '../../plugins/dataSource/reservedCommands';
import { pluginPermissionText } from '../../plugins/permissionLabel';

interface Props { plugin: PluginStatus; manager: PluginManagerState; expanded: boolean; onToggle: () => void }
export function PluginCard({ plugin, manager, expanded, onToggle }: Props) {
  const { t } = useI18n();
  const id = plugin.manifest.id;
  const active = plugin.state === 'running' && plugin.desiredEnabled && !manager.revoked.has(id);
  const webRuntime = manager.runtime.webRuntime === true;
  // The isolated window needs a desktop process; the browser session only exposes
  // commands and declarative panels.
  const hasInterface = Boolean((plugin.manifest.window && !webRuntime) || publicPluginCommands(plugin.manifest).length || plugin.manifest.contributes?.panels?.length);
  return <article className="plugin-card">
    <header className="plugin-card-header"><div>
      <Typography.Title level={5}>{plugin.manifest.name}</Typography.Title>
      <code className="plugin-identity">{id} · {plugin.manifest.version}</code>
    </div></header>
    {plugin.manifest.description && <Typography.Paragraph type="secondary">{plugin.manifest.description}</Typography.Paragraph>}
    {plugin.manifest.permissions.length > 0 && <div className="plugin-permissions">{plugin.manifest.permissions.map((permission) => <Tag key={permission}>{pluginPermissionText(permission, t, plugin.manifest.permissionNotes?.[permission])}</Tag>)}</div>}
    <PluginDataSourceSummary manifest={plugin.manifest} />
    <PluginAIProviderSummary manifest={plugin.manifest} />
    <PluginExporterSummary manifest={plugin.manifest} />
    <PluginSkillSummary manifest={plugin.manifest} />
    <PluginLifecycleControls plugin={plugin} allowed={manager.runtime.managementAllowed} safeMode={manager.runtime.safeMode}
      busy={Boolean(manager.busy[id])} onEnabled={(enabled) => void manager.setEnabled(id, enabled)} onRemove={() => void manager.remove(id, false)} />
    {plugin.lastError && <Alert showIcon type="error" message={t('plugin.card.last_error')} description={plugin.lastError} />}
    {active && hasInterface && <Button onClick={onToggle} aria-expanded={expanded}>{t(expanded ? 'plugin.action.close_panel' : 'plugin.action.open_panel')}</Button>}
    {active && expanded && <PluginCommandsPanel key={id + ':' + plugin.generation} plugin={plugin} allowed={manager.runtime.managementAllowed} webRuntime={webRuntime} />}
  </article>;
}
