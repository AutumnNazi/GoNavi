package db

import (
	"fmt"
	"strings"

	"GoNavi-Wails/internal/connection"
)

func normalizePGLikeMetadataTable(schemaName, tableName string) (string, string) {
	schema := strings.TrimSpace(schemaName)
	table := strings.TrimSpace(tableName)
	if parsedSchema, parsedTable := SplitSQLQualifiedName(table); parsedSchema != "" && parsedTable != "" {
		schema = parsedSchema
		table = parsedTable
	}
	schema = strings.TrimSpace(normalizeSQLIdentifierEscapes(schema))
	table = strings.TrimSpace(normalizeSQLIdentifierEscapes(table))
	schema = strings.Trim(schema, `"`)
	table = strings.Trim(table, `"`)
	return schema, table
}

func escapePGLikeMetadataLiteral(raw string) string {
	text := strings.TrimSpace(raw)
	text = strings.Trim(text, `"`)
	return strings.ReplaceAll(text, "'", "''")
}

func buildPGLikeVisibleRelationPredicate(alias string, schemaName string) string {
	relAlias := strings.TrimSpace(alias)
	if relAlias == "" {
		relAlias = "c"
	}
	if strings.TrimSpace(schemaName) == "" {
		return fmt.Sprintf("pg_catalog.pg_table_is_visible(%s.oid)", relAlias)
	}
	return fmt.Sprintf("n.nspname = '%s'", escapePGLikeMetadataLiteral(schemaName))
}

func buildPGLikeColumnsMetadataQuery(schemaName, tableName string) string {
	return fmt.Sprintf(`
SELECT
	a.attname AS column_name,
	pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
	CASE WHEN a.attnotnull THEN 'NO' ELSE 'YES' END AS is_nullable,
	pg_get_expr(ad.adbin, ad.adrelid) AS column_default,
	COALESCE(pg_catalog.to_jsonb(a)->>'attidentity', '') AS identity_generation,
	col_description(a.attrelid, a.attnum) AS comment,
	CASE WHEN pk.attname IS NOT NULL THEN 'PRI' ELSE '' END AS column_key
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_attribute a ON a.attrelid = c.oid
LEFT JOIN pg_attrdef ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
LEFT JOIN (
	SELECT i.indrelid, a3.attname
	FROM pg_index i
	JOIN pg_attribute a3 ON a3.attrelid = i.indrelid AND a3.attnum = ANY(i.indkey)
	WHERE i.indisprimary
) pk ON pk.indrelid = c.oid AND pk.attname = a.attname
WHERE c.relkind IN ('r', 'p')
  AND %s
  AND c.relname = '%s'
  AND a.attnum > 0
  AND NOT a.attisdropped
ORDER BY a.attnum`, buildPGLikeVisibleRelationPredicate("c", schemaName), escapePGLikeMetadataLiteral(tableName))
}

func buildPGLikeIndexesMetadataQuery(schemaName, tableName string) string {
	return fmt.Sprintf(`
SELECT
	i.relname AS index_name,
	a.attname AS column_name,
	ix.indisunique AS is_unique,
	x.ordinality AS seq_in_index,
	am.amname AS index_type
FROM pg_class t
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_index ix ON t.oid = ix.indrelid
JOIN pg_class i ON i.oid = ix.indexrelid
JOIN pg_am am ON i.relam = am.oid
JOIN unnest(ix.indkey) WITH ORDINALITY AS x(attnum, ordinality) ON TRUE
JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = x.attnum
WHERE t.relkind IN ('r', 'p')
  AND t.relname = '%s'
  AND %s
  AND ix.indisvalid
  AND ix.indpred IS NULL
  AND x.ordinality <= ix.indnkeyatts
  AND NOT EXISTS (
    SELECT 1 FROM unnest(ix.indkey) AS expr_key(attnum) WHERE expr_key.attnum <= 0
  )
ORDER BY i.relname, x.ordinality`, escapePGLikeMetadataLiteral(tableName), buildPGLikeVisibleRelationPredicate("t", schemaName))
}

func buildPGLikeColumnDefinitions(data []map[string]interface{}) []connection.ColumnDefinition {
	columns := make([]connection.ColumnDefinition, 0, len(data))
	for _, row := range data {
		col := connection.ColumnDefinition{
			Name:     fmt.Sprintf("%v", row["column_name"]),
			Type:     fmt.Sprintf("%v", row["data_type"]),
			Nullable: fmt.Sprintf("%v", row["is_nullable"]),
			Key:      fmt.Sprintf("%v", row["column_key"]),
			Extra:    "",
			Comment:  "",
		}

		if v, ok := row["comment"]; ok && v != nil {
			col.Comment = fmt.Sprintf("%v", v)
		}

		if v, ok := row["column_default"]; ok && v != nil {
			def := fmt.Sprintf("%v", v)
			col.Default = &def
			normalizedDefault := strings.ToLower(strings.TrimSpace(def))
			if strings.HasPrefix(normalizedDefault, "nextval(") || strings.HasPrefix(normalizedDefault, "pg_catalog.nextval(") {
				col.Extra = "auto_increment"
			}
		}
		if v, ok := row["identity_generation"]; ok && v != nil && strings.TrimSpace(fmt.Sprintf("%v", v)) != "" {
			col.Extra = "auto_increment"
		}

		columns = append(columns, col)
	}
	return columns
}

func buildPGLikeIndexDefinitions(data []map[string]interface{}) []connection.IndexDefinition {
	indexes := make([]connection.IndexDefinition, 0, len(data))
	for _, row := range data {
		isUnique := false
		if v, ok := row["is_unique"]; ok && v != nil {
			isUnique = parseMetadataBool(v)
		}

		nonUnique := 1
		if isUnique {
			nonUnique = 0
		}

		seq := 0
		if v, ok := row["seq_in_index"]; ok && v != nil {
			seq = parseMetadataInt(v)
		}

		indexType := ""
		if v, ok := row["index_type"]; ok && v != nil {
			indexType = strings.ToUpper(fmt.Sprintf("%v", v))
		}
		if indexType == "" {
			indexType = "BTREE"
		}

		indexes = append(indexes, connection.IndexDefinition{
			Name:       fmt.Sprintf("%v", row["index_name"]),
			ColumnName: fmt.Sprintf("%v", row["column_name"]),
			NonUnique:  nonUnique,
			SeqInIndex: seq,
			IndexType:  indexType,
		})
	}
	return indexes
}
