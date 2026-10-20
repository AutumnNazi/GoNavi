import { splitQualifiedNameSegmentsDetailed } from '../../utils/qualifiedName';
import { isMysqlFamilyDialect, quoteSqlIdentifierPart } from '../../utils/sqlDialect';
import { getMetadataDialect } from './sidebarMetadataBasics';
import type { SavedConnection } from '../../types';

export function sidebarMutationTableTarget(connection: SavedConnection, tableName: string): string {
  const dialect = getMetadataDialect(connection);
  const parts = isMysqlFamilyDialect(dialect) ? [tableName]
    : splitQualifiedNameSegmentsDetailed(tableName, dialect).map(part => part.value);
  return parts.map(part => quoteSqlIdentifierPart(dialect, part)).join('.');
}
