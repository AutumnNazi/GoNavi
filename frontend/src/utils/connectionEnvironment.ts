import type {
  ConnectionEnvironmentType,
  ConnectionTag,
  SavedConnection,
} from '../types';

type Translate = (key: string, params?: any) => string;

export type ConnectionEnvironmentMeta = {
  type: ConnectionEnvironmentType;
  color: string;
  labelKey: string;
};

export const DEFAULT_CONNECTION_ENVIRONMENT: ConnectionEnvironmentType = 'local';

export const CONNECTION_ENVIRONMENTS: readonly ConnectionEnvironmentMeta[] = [
  {
    type: 'production',
    color: '#e5484d',
    labelKey: 'connection.environment.production',
  },
  {
    type: 'test',
    color: '#f59e0b',
    labelKey: 'connection.environment.test',
  },
  {
    type: 'development',
    color: '#1677ff',
    labelKey: 'connection.environment.development',
  },
  {
    type: 'local',
    color: '#8c8c8c',
    labelKey: 'connection.environment.local',
  },
] as const;

const environmentByType = new Map<ConnectionEnvironmentType, ConnectionEnvironmentMeta>(
  CONNECTION_ENVIRONMENTS.map((item) => [item.type, item]),
);

export const normalizeConnectionEnvironmentType = (
  value: unknown,
): ConnectionEnvironmentType => {
  const normalized = String(value || '').trim().toLowerCase() as ConnectionEnvironmentType;
  return environmentByType.has(normalized)
    ? normalized
    : DEFAULT_CONNECTION_ENVIRONMENT;
};

export const getConnectionEnvironmentMeta = (
  value: unknown,
): ConnectionEnvironmentMeta => environmentByType.get(
  normalizeConnectionEnvironmentType(value),
) || environmentByType.get(DEFAULT_CONNECTION_ENVIRONMENT)!;

export const getConnectionEnvironmentOptions = (translate: Translate) =>
  CONNECTION_ENVIRONMENTS.map((item) => ({
    value: item.type,
    label: translate(item.labelKey),
    color: item.color,
  }));

export const findDirectConnectionTag = (
  connectionId: string | undefined,
  connectionTags: ConnectionTag[],
): ConnectionTag | undefined => {
  const normalizedConnectionId = String(connectionId || '').trim();
  if (!normalizedConnectionId) return undefined;
  return connectionTags.find((tag) => tag.connectionIds.includes(normalizedConnectionId));
};

export const resolveConnectionEnvironmentType = (
  connection: Pick<SavedConnection, 'id' | 'environmentType'> | null | undefined,
  connectionTags: ConnectionTag[],
): ConnectionEnvironmentType => {
  const directTag = findDirectConnectionTag(connection?.id, connectionTags);
  return directTag
    ? normalizeConnectionEnvironmentType(directTag.environmentType)
    : normalizeConnectionEnvironmentType(connection?.environmentType);
};

export const resolveConnectionEnvironmentPresentation = (
  connection: Pick<SavedConnection, 'id' | 'environmentType'> | null | undefined,
  connectionTags: ConnectionTag[],
  translate: Translate,
) => {
  const type = resolveConnectionEnvironmentType(connection, connectionTags);
  const meta = getConnectionEnvironmentMeta(type);
  return {
    type,
    color: meta.color,
    label: translate(meta.labelKey),
  };
};
