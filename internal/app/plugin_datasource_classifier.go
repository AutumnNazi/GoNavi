package app

import "strings"

// normalizeSQLClassifierDBType borrows only SQL grammar from a valid immutable
// plugin identity. It never rewrites ConnectionConfig.Type or selects a driver.
func normalizeSQLClassifierDBType(dbType string) string {
	if isPluginDataSourceType(dbType) {
		if dialect, valid := pluginDataSourceDialect(dbType); valid {
			return dialect
		}
		return invalidPluginDataSourceDialect
	}
	return normalizeBuiltinSQLClassifierDBType(dbType)
}

func normalizeBuiltinSQLClassifierDBType(dbType string) string {
	normalized := strings.ToLower(strings.TrimSpace(dbType))
	switch normalized {
	case "postgresql":
		return "postgres"
	case "mssql", "sql_server", "sql-server":
		return "sqlserver"
	case "open_gauss", "open-gauss":
		return "opengauss"
	case "gauss_db", "gauss-db":
		return "gaussdb"
	case "kingbase8", "kingbasees", "kingbasev8":
		return "kingbase"
	case "milvusdb", "milvus-db":
		return "milvus"
	case "intersystems", "intersystemsiris", "inter-systems", "inter-systems-iris":
		return "iris"
	case "cache", "caché", "intersystems cache", "intersystems caché", "intersystems-cache", "intersystems-caché", "intersystemscache", "intersystemscaché", "inter-systems-cache", "inter-systems-caché", "intersystems-cache-database", "cache-db", "cachedb":
		return "iris"
	default:
		// 描述表类型按借用方言分类（TiDB → mysql、OpenSearch → elasticsearch），与 resolveDDLDBType 一致。
		if dialect, ok := registryDDLDialect(normalized); ok {
			return dialect
		}
		return normalized
	}
}
