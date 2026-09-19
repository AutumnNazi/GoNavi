package db

import (
	"fmt"
	"regexp"
	"strings"
)

// duckDBAttachAliasPattern 限制别名为安全标识符，防止拼进 ATTACH/DETACH 语句的
// 别名注入额外子句。
var duckDBAttachAliasPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// duckDBAttachmentSpec 记录附加关系的关键参数，用于同源替换判定（保存文件重跑
// 时同源即替换重建、绑定最新凭据）与异源冲突报错。仅存活于连接实例内存中。
type duckDBAttachmentSpec struct {
	kind         string
	host         string
	port         int
	user         string
	password     string
	database     string
	filePath     string
	readOnly     bool
	connectionID string
}

// sameExternalAttachmentIdentity 判断两条附加记录是否同一数据源：
// 忽略 password（凭据轮换属同源重跑，应替换重建而非冲突）。
func sameExternalAttachmentIdentity(a, b duckDBAttachmentSpec) bool {
	a.password = ""
	b.password = ""
	return a == b
}

func buildDuckDBAttachStatement(spec ExternalAttachSpec) string {
	readOnly := ""
	if spec.ReadOnly {
		readOnly = ", READ_ONLY"
	}
	switch spec.Kind {
	case ExternalAttachKindMySQL:
		return fmt.Sprintf("ATTACH %s AS %s (TYPE MYSQL, SECRET %s%s)",
			quoteDuckDBStringLiteral(spec.Database), spec.Alias, spec.SecretName, readOnly)
	case ExternalAttachKindPostgres:
		return fmt.Sprintf("ATTACH '' AS %s (TYPE POSTGRES, SECRET %s%s)",
			spec.Alias, spec.SecretName, readOnly)
	case ExternalAttachKindSQLite:
		return fmt.Sprintf("ATTACH %s AS %s (TYPE SQLITE%s)",
			quoteDuckDBStringLiteral(spec.FilePath), spec.Alias, readOnly)
	default:
		if spec.ReadOnly {
			return fmt.Sprintf("ATTACH %s AS %s (READ_ONLY)", quoteDuckDBStringLiteral(spec.FilePath), spec.Alias)
		}
		return fmt.Sprintf("ATTACH %s AS %s", quoteDuckDBStringLiteral(spec.FilePath), spec.Alias)
	}
}

func quoteDuckDBStringLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}
