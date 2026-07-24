import type { AIProviderAuthMode, AIProviderConfig, AIProviderType } from '../types';

type ProviderEditorStatus = 'idle' | 'success' | 'error';

type ProviderEditorConfig = Partial<AIProviderConfig> & Pick<AIProviderConfig, 'id' | 'type' | 'name' | 'apiKey'> & { presetKey?: string };

export interface ProviderEditorSession {
  editingProvider: ProviderEditorConfig | null;
  formValues: Record<string, unknown> | null;
  isEditing: boolean;
  testStatus: ProviderEditorStatus;
}

interface BuildAddProviderEditorSessionInput {
  presetKey?: string;
  presetBackendType: AIProviderType;
  presetBaseUrl: string;
  presetModel: string;
  presetModels?: string[];
  apiFormat?: string;
  authMode?: AIProviderAuthMode;
}

interface BuildEditProviderEditorSessionInput {
  provider: ProviderEditorConfig;
  formValues?: Record<string, unknown>;
}

export const buildAddProviderEditorSession = ({
  presetKey = 'openai',
  presetBackendType,
  presetBaseUrl,
  presetModel,
  presetModels = [],
  apiFormat = 'openai',
  authMode = 'api-key',
}: BuildAddProviderEditorSessionInput): ProviderEditorSession => {
  const editingProvider: ProviderEditorConfig = {
    id: '',
    type: presetBackendType,
    name: '',
    apiKey: '',
    authMode,
    baseUrl: presetBaseUrl,
    model: presetModel,
    models: [...presetModels],
    maxTokens: 4096,
    temperature: 0.7,
    presetKey,
  };

  return {
    editingProvider,
    formValues: {
      ...editingProvider,
      presetKey,
      apiFormat,
      authMode,
    },
    isEditing: true,
    testStatus: 'idle',
  };
};

export const buildEditProviderEditorSession = ({
  provider,
  formValues,
}: BuildEditProviderEditorSessionInput): ProviderEditorSession => ({
  editingProvider: provider,
  formValues: formValues || {
    ...provider,
    models: provider.models || [],
    presetKey: provider.presetKey,
    apiFormat: provider.apiFormat || 'openai',
  },
  isEditing: true,
  testStatus: 'idle',
});

export const buildClosedProviderEditorSession = (): ProviderEditorSession => ({
  editingProvider: null,
  formValues: null,
  isEditing: false,
  testStatus: 'idle',
});

