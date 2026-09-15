import { splitQualifiedNameSegments, splitQualifiedNameSegmentsDetailed } from '../../utils/qualifiedName';

export type OracleCompilableObject = {
  kind: 'routine' | 'trigger';
  objectName: unknown;
  schemaName?: unknown;
  routineType?: unknown;
};

export type OracleCompileTarget = {
  objectType: string;
  objectName: string;
  schemaName?: string;
};

export type OracleCompileError = {
  objectName: string;
  objectType: string;
  sequence: number;
  line: number;
  position: number;
  text: string;
  attribute: string;
};

type OracleCompileQueryResult = {
  success?: boolean;
  data?: unknown;
};

const ORACLE_OBJECT_COMPILE_STATUSES = new Set(['VALID', 'INVALID']);
const ORACLE_COMPILE_OBJECT_TYPES = new Set([
  'PROCEDURE',
  'FUNCTION',
  'PACKAGE',
  'PACKAGE BODY',
  'TRIGGER',
  'TYPE',
  'TYPE BODY',
  'VIEW',
]);
const ORACLE_IDENT_RE = /^(?:"(?:[^"]|"")+"|[A-Za-z][A-Za-z0-9_$#]*)/;
const CREATE_COMPILE_OBJECT_RE = /\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:EDITIONABLE\s+|NONEDITIONABLE\s+)?(?:FORCE\s+|NOFORCE\s+)?(PACKAGE\s+BODY|TYPE\s+BODY|PROCEDURE|FUNCTION|TRIGGER|PACKAGE|TYPE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?/gi;
const ALTER_COMPILE_OBJECT_RE = /\bALTER\s+(PACKAGE|PROCEDURE|FUNCTION|TRIGGER|TYPE|VIEW)\s+/gi;

export const supportsOracleObjectCompilation = (dialect: unknown): boolean => {
  const normalized = String(dialect ?? '').trim().toLowerCase();
  return normalized === 'oracle' || normalized === 'dameng' || normalized === 'dm';
};

export const normalizeOracleObjectCompileStatus = (value: unknown): string => {
  const normalized = String(value ?? '').trim().toUpperCase();
  return ORACLE_OBJECT_COMPILE_STATUSES.has(normalized) ? normalized : '';
};

const quoteOracleIdentifier = (value: string): string => (
  `"${String(value || '').replace(/"/g, '""')}"`
);

const escapeOracleLiteral = (value: string): string => String(value || '').replace(/'/g, "''");

const toOracleStoredName = (raw: string, quoted: boolean): string => {
  const value = String(raw || '').trim();
  if (!value) return '';
  return quoted ? value : value.toUpperCase();
};

const maskOracleSqlForCompileScan = (source: string): string => (
  String(source || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
);

const parseOracleQualifiedName = (
  source: string,
  start: number,
): { schemaName: string; objectName: string; end: number } | null => {
  const slice = source.slice(start);
  const leadingWs = slice.match(/^\s*/)?.[0].length ?? 0;
  const first = slice.slice(leadingWs).match(ORACLE_IDENT_RE);
  if (!first) return null;

  let consumed = leadingWs + first[0].length;
  let raw = first[0];
  const dot = slice.slice(consumed).match(/^\s*\.\s*/);
  if (dot) {
    const second = slice.slice(consumed + dot[0].length).match(ORACLE_IDENT_RE);
    if (second) {
      consumed += dot[0].length + second[0].length;
      raw = `${raw}.${second[0]}`;
    }
  }

  const segments = splitQualifiedNameSegmentsDetailed(raw, 'oracle');
  if (segments.length === 0 || segments.length > 2) return null;
  const objectSegment = segments[segments.length - 1];
  const schemaSegment = segments.length === 2 ? segments[0] : undefined;
  const objectName = toOracleStoredName(objectSegment.value, objectSegment.quoted);
  if (!objectName) return null;

  return {
    schemaName: schemaSegment
      ? toOracleStoredName(schemaSegment.value, schemaSegment.quoted)
      : '',
    objectName,
    end: start + consumed,
  };
};

const pushCompileTarget = (
  targets: OracleCompileTarget[],
  seen: Set<string>,
  objectType: string,
  parsed: { schemaName: string; objectName: string },
) => {
  const normalizedType = String(objectType || '').replace(/\s+/g, ' ').trim().toUpperCase();
  if (!ORACLE_COMPILE_OBJECT_TYPES.has(normalizedType) || !parsed.objectName) return;
  const schemaName = String(parsed.schemaName || '').trim();
  const key = `${schemaName}::${normalizedType}::${parsed.objectName}`;
  if (seen.has(key)) return;
  seen.add(key);
  targets.push({
    objectType: normalizedType,
    objectName: parsed.objectName,
    ...(schemaName ? { schemaName } : {}),
  });
};

export const resolveOracleCompileTarget = ({
  kind,
  objectName,
  schemaName,
  routineType,
}: OracleCompilableObject): OracleCompileTarget | null => {
  const parsed = parseOracleQualifiedName(` ${String(objectName ?? '').trim()}`, 0);
  if (!parsed) return null;

  let schema = parsed.schemaName;
  if (!schema) {
    const schemaParts = splitQualifiedNameSegmentsDetailed(String(schemaName ?? '').trim(), 'oracle');
    if (schemaParts.length === 1) {
      schema = toOracleStoredName(schemaParts[0].value, schemaParts[0].quoted);
    } else if (schemaParts.length > 1) {
      return null;
    }
  }

  if (kind === 'trigger') {
    return {
      objectType: 'TRIGGER',
      objectName: parsed.objectName,
      ...(schema ? { schemaName: schema } : {}),
    };
  }
  if (kind !== 'routine') return null;
  const normalizedRoutineType = String(routineType ?? '').trim().toUpperCase();
  if (normalizedRoutineType !== 'PROCEDURE' && normalizedRoutineType !== 'FUNCTION') {
    return null;
  }
  return {
    objectType: normalizedRoutineType,
    objectName: parsed.objectName,
    ...(schema ? { schemaName: schema } : {}),
  };
};

const resolveOracleObjectReference = (
  objectName: unknown,
  schemaName: unknown,
): string => {
  const nameParts = splitQualifiedNameSegments(String(objectName ?? '').trim());
  if (nameParts.length === 0 || nameParts.length > 2) return '';

  const object = String(nameParts[nameParts.length - 1] || '').trim();
  if (!object) return '';

  let schema = nameParts.length === 2
    ? String(nameParts[0] || '').trim()
    : String(schemaName ?? '').trim();
  if (schema) {
    const schemaParts = splitQualifiedNameSegments(schema);
    if (schemaParts.length !== 1) return '';
    schema = String(schemaParts[0] || '').trim();
  }

  return [schema, object]
    .filter(Boolean)
    .map(quoteOracleIdentifier)
    .join('.');
};

export const buildOracleObjectCompileSQL = ({
  kind,
  objectName,
  schemaName,
  routineType,
}: OracleCompilableObject): string => {
  const objectReference = resolveOracleObjectReference(objectName, schemaName);
  if (!objectReference) return '';

  if (kind === 'trigger') {
    return `ALTER TRIGGER ${objectReference} COMPILE`;
  }
  if (kind !== 'routine') return '';

  const normalizedRoutineType = String(routineType ?? '').trim().toUpperCase();
  if (normalizedRoutineType !== 'PROCEDURE' && normalizedRoutineType !== 'FUNCTION') {
    return '';
  }
  return `ALTER ${normalizedRoutineType} ${objectReference} COMPILE`;
};

export const collectOracleCompileTargets = (statements: string[]): OracleCompileTarget[] => {
  const targets: OracleCompileTarget[] = [];
  const seen = new Set<string>();

  statements.forEach((statement) => {
    const masked = maskOracleSqlForCompileScan(statement);
    CREATE_COMPILE_OBJECT_RE.lastIndex = 0;
    let createMatch: RegExpExecArray | null;
    while ((createMatch = CREATE_COMPILE_OBJECT_RE.exec(masked))) {
      const parsed = parseOracleQualifiedName(masked, createMatch.index + createMatch[0].length);
      if (!parsed) continue;
      pushCompileTarget(targets, seen, createMatch[1], parsed);
      CREATE_COMPILE_OBJECT_RE.lastIndex = parsed.end;
    }

    ALTER_COMPILE_OBJECT_RE.lastIndex = 0;
    let alterMatch: RegExpExecArray | null;
    while ((alterMatch = ALTER_COMPILE_OBJECT_RE.exec(masked))) {
      const parsed = parseOracleQualifiedName(masked, alterMatch.index + alterMatch[0].length);
      if (!parsed) continue;
      const compileMatch = masked.slice(parsed.end).match(/^\s+COMPILE(?:\s+DEBUG)?(?:\s+(BODY|SPECIFICATION))?\b/i);
      if (!compileMatch) continue;
      const baseType = String(alterMatch[1] || '').trim().toUpperCase();
      const compileSuffix = String(compileMatch[1] || '').trim().toUpperCase();
      const objectType = (baseType === 'PACKAGE' || baseType === 'TYPE') && compileSuffix === 'BODY'
        ? `${baseType} BODY`
        : baseType;
      pushCompileTarget(targets, seen, objectType, parsed);
      ALTER_COMPILE_OBJECT_RE.lastIndex = parsed.end + compileMatch[0].length;
    }
  });

  return targets;
};

const buildOracleErrorsWhereClauses = (targets: OracleCompileTarget[]): string[] => (
  targets.map((target) => {
    const objectType = String(target.objectType || '').trim().toUpperCase();
    const objectName = String(target.objectName || '').trim();
    if (!ORACLE_COMPILE_OBJECT_TYPES.has(objectType) || !objectName) return '';
    const schemaName = String(target.schemaName || '').trim();
    const nameClause = `NAME = '${escapeOracleLiteral(objectName)}' AND TYPE = '${escapeOracleLiteral(objectType)}'`;
    return schemaName
      ? `(OWNER = '${escapeOracleLiteral(schemaName)}' AND ${nameClause})`
      : `(${nameClause})`;
  }).filter(Boolean)
);

export const buildOracleObjectErrorsSQL = (
  targets: OracleCompileTarget[],
  view: 'ALL_ERRORS' | 'USER_ERRORS' = 'USER_ERRORS',
): string => {
  const clauses = buildOracleErrorsWhereClauses(targets);
  if (clauses.length === 0) return '';
  return [
    'SELECT NAME AS object_name, TYPE AS object_type, SEQUENCE AS error_sequence,',
    'LINE AS error_line, POSITION AS error_position, TEXT AS error_text',
    `FROM ${view}`,
    `WHERE ${clauses.join(' OR ')}`,
    'ORDER BY NAME, TYPE, SEQUENCE, LINE, POSITION',
  ].join(' ');
};

const readCaseInsensitiveValue = (row: Record<string, unknown>, keys: string[]): string => {
  const keyMap = new Map<string, unknown>();
  Object.keys(row || {}).forEach((key) => keyMap.set(key.toLowerCase(), row[key]));
  for (const key of keys) {
    const value = keyMap.get(key.toLowerCase());
    if (value !== undefined && value !== null) {
      const normalized = String(value).trim();
      if (normalized) return normalized;
    }
  }
  return '';
};

const parseOracleNumber = (value: string): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const normalizeOracleCompileQueryRows = (data: unknown): Record<string, unknown>[] => {
  if (Array.isArray(data)) {
    return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
  }
  if (data && typeof data === 'object') {
    const rows = (data as { rows?: unknown }).rows;
    if (Array.isArray(rows)) {
      return rows.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === 'object');
    }
  }
  return [];
};

export const parseOracleCompileErrorRows = (data: unknown): OracleCompileError[] => (
  normalizeOracleCompileQueryRows(data).flatMap((row) => {
    const text = readCaseInsensitiveValue(row, ['error_text', 'text', 'message']);
    const attribute = readCaseInsensitiveValue(row, ['error_attribute', 'attribute']).toUpperCase();
    if (!text || attribute === 'WARNING') return [];
    return [{
      objectName: readCaseInsensitiveValue(row, ['object_name', 'name']),
      objectType: readCaseInsensitiveValue(row, ['object_type', 'type']).toUpperCase(),
      sequence: parseOracleNumber(readCaseInsensitiveValue(row, ['error_sequence', 'sequence'])),
      line: parseOracleNumber(readCaseInsensitiveValue(row, ['error_line', 'line'])),
      position: parseOracleNumber(readCaseInsensitiveValue(row, ['error_position', 'position'])),
      text,
      attribute,
    }];
  })
);

export const formatOracleCompileErrors = (errors: OracleCompileError[]): string => (
  errors.map((error) => {
    const objectLabel = [error.objectType, error.objectName].filter(Boolean).join(' ');
    const location = [
      error.line > 0 ? `line ${error.line}` : '',
      error.position > 0 ? `position ${error.position}` : '',
    ].filter(Boolean).join(', ');
    const prefix = [objectLabel, location].filter(Boolean).join(', ');
    return prefix ? `${prefix}: ${error.text}` : error.text;
  }).join('\n')
);

const uniqueOracleCompileErrors = (errors: OracleCompileError[]): OracleCompileError[] => {
  const seen = new Set<string>();
  return errors.filter((error) => {
    const key = [
      error.objectType,
      error.objectName,
      error.sequence,
      error.line,
      error.position,
      error.text,
    ].join('\u0000');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const loadOracleCompileErrors = async (
  targets: OracleCompileTarget[],
  options: {
    query: (sql: string) => Promise<OracleCompileQueryResult>;
  },
): Promise<OracleCompileError[]> => {
  const validTargets = targets.filter((target) => (
    ORACLE_COMPILE_OBJECT_TYPES.has(String(target.objectType || '').trim().toUpperCase())
    && String(target.objectName || '').trim()
  ));
  if (validTargets.length === 0) return [];

  const ownedTargets = validTargets.filter((target) => String(target.schemaName || '').trim());
  const localTargets = validTargets.filter((target) => !String(target.schemaName || '').trim());
  const queries = [
    localTargets.length > 0 ? buildOracleObjectErrorsSQL(localTargets, 'USER_ERRORS') : '',
    ownedTargets.length > 0 ? buildOracleObjectErrorsSQL(ownedTargets, 'ALL_ERRORS') : '',
    // Unqualified CREATE lands in the current schema. If the caller also
    // attached a schema, still ask USER_ERRORS so a mismatched OWNER does not
    // hide the real compile diagnostic.
    ownedTargets.length > 0 ? buildOracleObjectErrorsSQL(
      ownedTargets.map((target) => ({ ...target, schemaName: undefined })),
      'USER_ERRORS',
    ) : '',
  ].filter(Boolean);

  const errors: OracleCompileError[] = [];
  for (const sql of queries) {
    try {
      const result = await options.query(sql);
      if (!result?.success) continue;
      errors.push(...parseOracleCompileErrorRows(result.data));
    } catch {
      // Compile diagnostics are best-effort; a metadata query failure must not
      // mask the original CREATE/ALTER outcome.
    }
  }
  return uniqueOracleCompileErrors(errors);
};
