import { normalizeDriverType } from '../../utils/connectionDriverType';

export const INTERSYSTEMS_STORED_URI_FIELD = 'intersystemsHasStoredURI';

export const usesInterSystemsNamespace = (type: string): boolean =>
  ['iris', 'cache'].includes(normalizeDriverType(type));

const normalizeNamespace = (value: string): string => value.trim().replace(/^\/+|\/+$/g, '');

export const getInterSystemsURINamespace = (type: string, uri?: string): string => {
  if (!usesInterSystemsNamespace(type)) return '';
  // applyIRISURI accepts all five schemes for both products and strips a JDBC prefix.
  const text = String(uri || '').trim().replace(/^jdbc:/i, '').trim();
  if (!/^(?:iris|intersystems|cache|intersystems-cache|intersystemscache):\//i.test(text)) return '';
  try {
    const parsed = new URL(text);
    // Read the original path: WHATWG URL resolves dot segments, unlike Go's net/url.
    const target = text.slice(text.indexOf(':') + 1).split(/[?#]/, 1)[0];
    const path = target.startsWith('//') ? target.replace(/^\/\/[^/]*/, '') : target;
    if (parsed.username || parsed.password) {
      decodeURIComponent(parsed.username);
      decodeURIComponent(parsed.password);
    }
    return normalizeNamespace(decodeURIComponent(path));
  } catch {
    return '';
  }
};

// Match the driver's URI-path precedence so saved, tested and edited targets agree.
export const resolveConnectionDatabaseValue = (
  type: string,
  database: string | undefined,
  uri: string | undefined,
): string | undefined => {
  if (!usesInterSystemsNamespace(type)) return database;
  return getInterSystemsURINamespace(type, uri) || normalizeNamespace(database || '');
};
