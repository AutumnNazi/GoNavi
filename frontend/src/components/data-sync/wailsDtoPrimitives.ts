export class DataSyncGatewayProtocolError extends Error {
  constructor(operation: string, detail: string) {
    super(`${operation}: ${detail}`);
    this.name = 'DataSyncGatewayProtocolError';
  }
}

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

export const record = (value: unknown, path: string): Record<string, unknown> => {
  if (!isRecord(value)) throw new DataSyncGatewayProtocolError(path, 'expected object');
  return value;
};

export const array = (value: unknown, path: string): unknown[] => {
  if (!Array.isArray(value)) throw new DataSyncGatewayProtocolError(path, 'expected array');
  return value;
};

export const string = (value: unknown, path: string, allowEmpty = true): string => {
  if (typeof value !== 'string') {
    throw new DataSyncGatewayProtocolError(path, 'expected string');
  }
  if (!allowEmpty && !value.trim()) {
    throw new DataSyncGatewayProtocolError(path, 'expected non-empty string');
  }
  return value;
};

export const optionalString = (value: unknown, path: string): string =>
  value === undefined || value === null ? '' : string(value, path);

export const number = (value: unknown, path: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DataSyncGatewayProtocolError(path, 'expected finite number');
  }
  return value;
};

export const optionalNumber = (value: unknown, path: string, fallback = 0): number =>
  value === undefined || value === null ? fallback : number(value, path);

export const optionalMetadataNumber = (
  value: unknown,
  path: string,
): number | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  const decoded =
    typeof value === 'string' && value.trim()
      ? Number(value)
      : number(value, path);
  if (!Number.isFinite(decoded) || decoded < 0 || !Number.isSafeInteger(decoded)) {
    throw new DataSyncGatewayProtocolError(
      path,
      'expected non-negative safe integer',
    );
  }
  return decoded;
};

export const boolean = (value: unknown, path: string): boolean => {
  if (typeof value !== 'boolean') {
    throw new DataSyncGatewayProtocolError(path, 'expected boolean');
  }
  return value;
};

export const optionalBoolean = (
  value: unknown,
  path: string,
  fallback = false,
): boolean => (value === undefined || value === null ? fallback : boolean(value, path));

export const enumValue = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T => {
  const decoded = string(value, path);
  if (!allowed.includes(decoded as T)) {
    throw new DataSyncGatewayProtocolError(path, `unsupported value ${decoded}`);
  }
  return decoded as T;
};

export const fromMillis = (value: unknown, path: string): string => {
  const millis = optionalNumber(value, path);
  if (millis <= 0) return '';
  const date = new Date(millis);
  if (!Number.isFinite(date.getTime())) {
    throw new DataSyncGatewayProtocolError(path, 'invalid timestamp');
  }
  return date.toISOString();
};

export const toMillis = (value: string): number => {
  if (!value.trim()) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export const rawJSONText = (value: unknown, path: string): string => {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    if (!value.trim()) return '';
    try {
      JSON.parse(value);
      return value;
    } catch {
      throw new DataSyncGatewayProtocolError(path, 'invalid JSON string');
    }
  }
  if (Array.isArray(value) && value.every((item) => Number.isInteger(item))) {
    try {
      const decoded = new TextDecoder().decode(new Uint8Array(value as number[]));
      JSON.parse(decoded);
      return decoded;
    } catch {
      throw new DataSyncGatewayProtocolError(path, 'invalid JSON bytes');
    }
  }
  try {
    return JSON.stringify(value);
  } catch {
    throw new DataSyncGatewayProtocolError(path, 'JSON value is not serializable');
  }
};

export const toRawJSON = (value: string, path: string): unknown => {
  if (!value.trim()) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new DataSyncGatewayProtocolError(path, 'invalid JSON argument');
  }
};
