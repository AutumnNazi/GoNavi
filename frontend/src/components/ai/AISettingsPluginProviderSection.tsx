import AISettingsProvidersSection, { type AISettingsProvidersSectionProps } from './AISettingsProvidersSection';
import { isPluginAIProviderNamespace } from '../../plugins/aiProvider/identity';
import { AIPluginProviderEditor } from './AIPluginProviderEditor';
import { AIPluginProviderCatalog } from './AIPluginProviderCatalog';
import './AIPluginProvider.css';
export default function AISettingsPluginProviderSection(props: AISettingsProvidersSectionProps) {
  const plugin = isPluginAIProviderNamespace(props.editingProvider?.type) || isPluginAIProviderNamespace(props.watchedPresetKey);
  if (props.isEditing && plugin) return <AIPluginProviderEditor {...props} />;
  return <div className="gn-plugin-provider-section"><div className="gn-plugin-provider-builtin">
    <AISettingsProvidersSection {...props} providers={props.providers.filter((provider) => !isPluginAIProviderNamespace(provider.type))} />
  </div><AIPluginProviderCatalog {...props} /></div>;
}
