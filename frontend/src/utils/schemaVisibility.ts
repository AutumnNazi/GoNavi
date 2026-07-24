import type { SavedConnection, SchemaVisibilityRule } from '../types';

const normalizeIdentifier = (value: unknown): string =>
  String(value || '').trim().toLocaleLowerCase();

export const normalizeSchemaVisibilityRule = (
  value: unknown,
): SchemaVisibilityRule | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const mode = raw.mode === 'include' || raw.mode === 'exclude'
    ? raw.mode
    : undefined;
  if (!mode || !Array.isArray(raw.schemas)) return undefined;

  const seen = new Set<string>();
  const schemas = raw.schemas.reduce<string[]>((result, item) => {
    const schema = String(item || '').trim();
    const key = normalizeIdentifier(schema);
    if (!schema || !key || seen.has(key)) return result;
    seen.add(key);
    result.push(schema);
    return result;
  }, []);

  return schemas.length > 0 ? { mode, schemas } : undefined;
};

export const getSchemaVisibilityRule = (
  connection: Pick<SavedConnection, 'schemaVisibilityByDatabase'> | null | undefined,
  dbName: unknown,
): SchemaVisibilityRule | undefined => {
  const databaseKey = String(dbName || '').trim();
  if (!databaseKey || !connection?.schemaVisibilityByDatabase) return undefined;
  const rules = connection.schemaVisibilityByDatabase;
  const exact = normalizeSchemaVisibilityRule(rules[databaseKey]);
  if (exact) return exact;

  const normalizedDatabaseKey = normalizeIdentifier(databaseKey);
  const matchedKey = Object.keys(rules).find(
    (key) => normalizeIdentifier(key) === normalizedDatabaseKey,
  );
  return matchedKey ? normalizeSchemaVisibilityRule(rules[matchedKey]) : undefined;
};

export const isSchemaVisible = (
  rule: SchemaVisibilityRule | undefined,
  schemaName: unknown,
): boolean => {
  if (!rule) return true;
  const normalizedSchemaName = normalizeIdentifier(schemaName);
  const selected = rule.schemas.some(
    (schema) => normalizeIdentifier(schema) === normalizedSchemaName,
  );
  return rule.mode === 'include' ? selected : !selected;
};

export const updateSchemaVisibilityRule = (
  connection: SavedConnection,
  dbName: unknown,
  rule: SchemaVisibilityRule | undefined,
): SavedConnection => {
  const databaseName = String(dbName || '').trim();
  if (!databaseName) return connection;

  const nextRules = { ...(connection.schemaVisibilityByDatabase || {}) };
  const existingKey = Object.keys(nextRules).find(
    (key) => normalizeIdentifier(key) === normalizeIdentifier(databaseName),
  );
  if (existingKey && existingKey !== databaseName) {
    delete nextRules[existingKey];
  }
  if (rule) {
    nextRules[databaseName] = rule;
  } else {
    delete nextRules[databaseName];
  }

  return {
    ...connection,
    schemaVisibilityByDatabase:
      Object.keys(nextRules).length > 0 ? nextRules : undefined,
  };
};

export const moveSchemaVisibilityRule = (
  connection: SavedConnection,
  fromDbName: unknown,
  toDbName: unknown,
): SavedConnection => {
  const rule = getSchemaVisibilityRule(connection, fromDbName);
  const destination = String(toDbName || '').trim();
  if (!rule || !destination) return connection;

  return updateSchemaVisibilityRule(
    updateSchemaVisibilityRule(connection, fromDbName, undefined),
    destination,
    rule,
  );
};
