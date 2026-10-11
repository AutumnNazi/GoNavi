// Package mockdata 为关系型数据表生成模拟数据：解析列类型、给出生成规则建议、按规则逐行产出值。
//
// 包内只做纯计算，不连库、不做 i18n：错误以 PlanError 的错误码返回，由绑定层翻译成界面文案。
// 产出的值是"单元格文本"（与 CSV 导入同形），写入时交给导入管线和各驱动的 ApplyChanges 处理方言差异。
package mockdata

import "strings"

// Family 是生成规则关心的方言族：同一族的类型名、取值范围、布尔字面量和分页写法一致。
type Family string

// 方言族。Generic 兜底未知的关系型数据源（含 QuestDB），按 SQL 标准类型名处理。
// GreptimeDB 的类型名与 ClickHouse 同构（Int8 表示 8 位），归入 ClickHouse 族。
const (
	FamilyMySQL      Family = "mysql"
	FamilyPostgres   Family = "postgres"
	FamilyOracle     Family = "oracle"
	FamilyDameng     Family = "dameng"
	FamilySQLServer  Family = "sqlserver"
	FamilySQLite     Family = "sqlite"
	FamilyDuckDB     Family = "duckdb"
	FamilyClickHouse Family = "clickhouse"
	FamilyTDengine   Family = "tdengine"
	FamilyFirebird   Family = "firebird"
	FamilyInformix   Family = "informix"
	FamilyIRIS       Family = "iris"
	FamilyGeneric    Family = "generic"
)

var familyByDialect = map[string]Family{
	"mysql":       FamilyMySQL,
	"mariadb":     FamilyMySQL,
	"oceanbase":   FamilyMySQL,
	"goldendb":    FamilyMySQL,
	"tidb":        FamilyMySQL,
	"diros":       FamilyMySQL,
	"doris":       FamilyMySQL,
	"starrocks":   FamilyMySQL,
	"sphinx":      FamilyMySQL,
	"gbase8a":     FamilyMySQL,
	"postgres":    FamilyPostgres,
	"postgresql":  FamilyPostgres,
	"kingbase":    FamilyPostgres,
	"highgo":      FamilyPostgres,
	"vastbase":    FamilyPostgres,
	"opengauss":   FamilyPostgres,
	"gaussdb":     FamilyPostgres,
	"gbase8c":     FamilyPostgres,
	"cockroachdb": FamilyPostgres,
	"timescaledb": FamilyPostgres,
	"kwdb":        FamilyPostgres,
	"oracle":      FamilyOracle,
	"dameng":      FamilyDameng,
	"yashandb":    FamilyOracle,
	"sqlserver":   FamilySQLServer,
	"sqlite":      FamilySQLite,
	"duckdb":      FamilyDuckDB,
	"clickhouse":  FamilyClickHouse,
	"greptimedb":  FamilyClickHouse,
	"tdengine":    FamilyTDengine,
	"firebird":    FamilyFirebird,
	"gbase8s":     FamilyInformix,
	"iris":        FamilyIRIS,
	"cache":       FamilyIRIS,
}

// ResolveFamily 把绑定层解析出的 DDL 方言名（resolveDDLDBType 的结果）映射到方言族。
func ResolveFamily(dialect string) Family {
	if family, ok := familyByDialect[strings.ToLower(strings.TrimSpace(dialect))]; ok {
		return family
	}
	return FamilyGeneric
}

// booleanLiterals 返回该族 BOOLEAN 列的真/假写法；MySQL BOOL 即 tinyint(1)，写 1/0。
func (f Family) booleanLiterals() (string, string) {
	switch f {
	case FamilyPostgres, FamilyDuckDB, FamilyClickHouse, FamilyTDengine, FamilyGeneric:
		return "true", "false"
	case FamilyInformix:
		return "t", "f"
	default:
		return "1", "0"
	}
}

// countsLengthInBytes 表示未写 CHAR 语义时字符串长度按字节计：
// Oracle/达梦默认 NLS_LENGTH_SEMANTICS=BYTE，Informix 的 VARCHAR 长度也是字节。
func (f Family) countsLengthInBytes() bool {
	return f == FamilyOracle || f == FamilyDameng || f == FamilyInformix
}
