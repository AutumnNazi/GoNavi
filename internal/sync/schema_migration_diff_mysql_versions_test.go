package sync

import (
	"testing"

	"GoNavi-Wails/internal/connection"
)

// MySQL 8.0 起不再报告整数显示宽度：5.7 的列类型与 8.0 读回的列类型逐对对照。
// 右侧取自 MySQL 8.2 对左侧建表后 information_schema.COLUMNS 的真实返回值。
var mysql57To8ColumnTypes = [][2]string{
	{"bigint(20)", "bigint"},
	{"bigint(20) unsigned", "bigint unsigned"},
	{"bigint(12) unsigned", "bigint unsigned"},
	{"int(11)", "int"},
	{"int(10) unsigned", "int unsigned"},
	{"int(11) unsigned", "int unsigned"},
	{"mediumint(8) unsigned", "mediumint unsigned"},
	{"mediumint(30) unsigned", "mediumint unsigned"},
	{"smallint(6)", "smallint"},
	{"smallint(5) unsigned", "smallint unsigned"},
	{"tinyint(4)", "tinyint"},
	{"tinyint(3) unsigned", "tinyint unsigned"},
	{"tinyint(1) unsigned", "tinyint unsigned"},
	{"tinyint(1)", "tinyint(1)"},
	{"year(4)", "year"},
	{"int(4) unsigned zerofill", "int(4) unsigned zerofill"},
	{"smallint(4) unsigned zerofill", "smallint(4) unsigned zerofill"},
	{"decimal(10,2) unsigned", "decimal(10,2) unsigned"},
	{"float(3,1) unsigned", "float(3,1) unsigned"},
	{"double(18,1)", "double(18,1)"},
	{"datetime(3)", "datetime(3)"},
	{"varchar(255)", "varchar(255)"},
	{"enum('0','1')", "enum('0','1')"},
}

func TestNormalizeComparableColumnTypeMatchesMySQL57And8(t *testing.T) {
	for _, pair := range mysql57To8ColumnTypes {
		legacy := normalizeComparableColumnType("mysql", pair[0])
		current := normalizeComparableColumnType("mysql", pair[1])
		if legacy != current {
			t.Errorf("5.7 %q -> %q, 8.0 %q -> %q; want the same comparable type", pair[0], legacy, pair[1], current)
		}
	}
}

func TestNormalizeComparableColumnTypeKeepsRealDifferences(t *testing.T) {
	for _, pair := range [][2]string{
		{"int unsigned", "int"},
		{"int(11) unsigned", "int(11)"},
		{"bigint", "int"},
		{"varchar(32)", "varchar(64)"},
		{"decimal(10,2)", "decimal(12,2)"},
		{"int(4) unsigned zerofill", "int unsigned"},
	} {
		if normalizeComparableColumnType("mysql", pair[0]) == normalizeComparableColumnType("mysql", pair[1]) {
			t.Errorf("%q and %q are different column types and must stay different", pair[0], pair[1])
		}
	}
}

// 5.7 源表同步到 8.0 已存在的目标表时，显示宽度差异不能被当成结构差异拦截。
func TestUnsupportedExistingTargetSchemaDiffsIgnoresMySQL8DisplayWidth(t *testing.T) {
	source := make([]connection.ColumnDefinition, 0, len(mysql57To8ColumnTypes))
	target := make([]connection.ColumnDefinition, 0, len(mysql57To8ColumnTypes))
	for index, pair := range mysql57To8ColumnTypes {
		name := string(rune('a' + index))
		source = append(source, connection.ColumnDefinition{Name: name, Type: pair[0], Nullable: "NO"})
		target = append(target, connection.ColumnDefinition{Name: name, Type: pair[1], Nullable: "NO"})
	}
	if diffs := UnsupportedExistingTargetSchemaDiffs(source, target, "mysql", "mysql"); len(diffs) != 0 {
		t.Fatalf("display-width-only differences were reported as unsupported: %+v", diffs)
	}
}
