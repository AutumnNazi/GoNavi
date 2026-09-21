import type { TriggerDefinition } from '../types';
import { quoteSqlIdentifierPath, resolveSqlDialect } from '../utils/sqlDialect';

const stripLeadingSqlTrivia = (sql: string): string => {
  const text = String(sql || '');
  let offset = 0;
  for (;;) {
    while (offset < text.length && /\s/.test(text[offset] || '')) offset += 1;
    if (text.startsWith('/*', offset)) {
      const end = text.indexOf('*/', offset + 2);
      if (end < 0) return '';
      offset = end + 2;
      continue;
    }
    if (text.startsWith('--', offset) || text.startsWith('#', offset)) {
      const end = text.indexOf('\n', offset);
      if (end < 0) return '';
      offset = end + 1;
      continue;
    }
    return text.slice(offset);
  }
};

const takeQuotedIdentifier = (text: string, quote: string, closer = quote): { name: string; rest: string } | null => {
  if (!text.startsWith(quote)) return null;
  let index = quote.length;
  let name = '';
  while (index < text.length) {
    if (text.startsWith(closer, index)) {
      if (closer.length === 1 && text[index + 1] === closer) {
        name += closer;
        index += 2;
        continue;
      }
      return { name, rest: text.slice(index + closer.length) };
    }
    name += text[index];
    index += 1;
  }
  return null;
};

const takeIdentifier = (text: string): { name: string; rest: string } => {
  const source = text.trimStart();
  const quoted = takeQuotedIdentifier(source, '`')
    || takeQuotedIdentifier(source, '"')
    || takeQuotedIdentifier(source, '[', ']');
  if (quoted) return quoted;
  const match = source.match(/^[A-Za-z_][\w$]*/);
  if (!match) return { name: '', rest: source };
  return { name: match[0], rest: source.slice(match[0].length) };
};

const takeQualifiedName = (text: string): { name: string; rest: string } => {
  let remaining = text;
  let name = '';
  for (;;) {
    const parsed = takeIdentifier(remaining);
    if (!parsed.name) break;
    name = parsed.name;
    remaining = parsed.rest.trimStart();
    if (!remaining.startsWith('.')) break;
    remaining = remaining.slice(1);
  }
  return { name, rest: remaining };
};

const TRIGGER_HEADER = /CREATE\s+(?:OR\s+(?:REPLACE|ALTER)\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:(?:EDITIONABLE|NONEDITIONABLE|CONSTRAINT)\s+)*TRIGGER(?:\s+IF\s+NOT\s+EXISTS)?\s+/ig;

const parseTimingEvent = (text: string): { timing: string; event: string } => {
  const match = String(text || '').match(
    /\b(BEFORE|AFTER|INSTEAD\s+OF)\b\s+((?:INSERT|UPDATE|DELETE)(?:\s+OR\s+(?:INSERT|UPDATE|DELETE))*)/i,
  );
  return {
    timing: match?.[1] ? match[1].replace(/\s+/g, ' ').toUpperCase() : '',
    event: match?.[2] ? match[2].replace(/\s+/g, ' ').toUpperCase() : '',
  };
};

export const parseTriggerDraftFromSql = (sql: string): TriggerDefinition | null => {
  const statement = String(sql || '').trim();
  if (!statement) return null;
  const source = stripLeadingSqlTrivia(statement);
  const header = new RegExp(TRIGGER_HEADER.source, 'ig');
  let last: TriggerDefinition | null = null;
  let match: RegExpExecArray | null = header.exec(source);
  while (match) {
    const parsed = takeQualifiedName(source.slice(match.index + match[0].length));
    if (parsed.name) {
      const timingEvent = parseTimingEvent(parsed.rest);
      last = {
        name: parsed.name,
        timing: timingEvent.timing,
        event: timingEvent.event,
        statement,
      };
    }
    match = header.exec(source);
  }
  return last;
};

export const replaceTriggerDrafts = (
  triggers: TriggerDefinition[],
  previousName: string | undefined,
  next: TriggerDefinition,
): TriggerDefinition[] => {
  const previous = String(previousName || '').trim().toUpperCase();
  const nextName = String(next.name || '').trim().toUpperCase();
  const kept = triggers.filter((trigger) => {
    const name = String(trigger.name || '').trim().toUpperCase();
    if (previous && name === previous) return false;
    if (name === nextName) return false;
    return true;
  });
  return [...kept, next];
};

export const removeTriggerDraftByName = (
  triggers: TriggerDefinition[],
  triggerName: string,
): TriggerDefinition[] => {
  const drop = String(triggerName || '').trim().toUpperCase();
  return triggers.filter((trigger) => String(trigger.name || '').trim().toUpperCase() !== drop);
};

export const collectCreateTableTriggerSql = (triggers: TriggerDefinition[] | undefined): string => (
  (Array.isArray(triggers) ? triggers : [])
    .map((trigger) => String(trigger.statement || '').trim())
    .filter(Boolean)
    .join('\n\n')
);

export const buildTableDesignerTriggerTemplate = (dbType: string, tableRef: string): string => {
  const dialect = resolveSqlDialect(dbType);
  const target = tableRef || quoteSqlIdentifierPath(dialect, 'table_name') || 'table_name';
  switch (dialect) {
    case 'mysql':
    case 'mariadb':
    case 'oceanbase':
    case 'diros':
    case 'starrocks':
    case 'tidb':
      return `CREATE TRIGGER trigger_name
BEFORE INSERT ON ${target}
FOR EACH ROW
BEGIN
    -- Trigger logic
END;`;
    case 'postgres':
    case 'kingbase':
    case 'highgo':
    case 'vastbase':
    case 'opengauss':
    case 'gaussdb':
      return `CREATE OR REPLACE FUNCTION trigger_function_name()
RETURNS TRIGGER AS $$
BEGIN
    -- Trigger logic
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_name
BEFORE INSERT ON ${target}
FOR EACH ROW
EXECUTE FUNCTION trigger_function_name();`;
    case 'sqlserver':
      return `CREATE TRIGGER trigger_name
ON ${target}
AFTER INSERT
AS
BEGIN
    SET NOCOUNT ON;
    -- Trigger logic
END;`;
    case 'oracle':
    case 'dameng':
    case 'dm':
      return `CREATE OR REPLACE TRIGGER trigger_name
BEFORE INSERT ON ${target}
FOR EACH ROW
BEGIN
    -- Trigger logic
    NULL;
END;`;
    case 'sqlite':
      return `CREATE TRIGGER trigger_name
AFTER INSERT ON ${target}
BEGIN
    -- Trigger logic
END;`;
    default:
      return '-- Enter a CREATE TRIGGER statement';
  }
};
