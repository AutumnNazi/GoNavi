package mockdata

import (
	"slices"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestResolveCategoryAcrossDialects(t *testing.T) {
	cases := []struct {
		name    string
		dialect string
		typ     string
		want    Category
	}{
		{"mysql int display width", "mysql", "int(11) unsigned", CategoryInteger},
		{"mysql tinyint(1) is bool", "mysql", "tinyint(1)", CategoryBoolean},
		{"mysql tinyint(4) is int", "mysql", "tinyint(4)", CategoryInteger},
		{"mysql enum", "mysql", "enum('a','b')", CategoryEnum},
		{"mysql set", "mysql", "set('x','y')", CategorySet},
		{"mysql bit", "mysql", "bit(8)", CategoryBit},
		{"mysql decimal scale 0 is integer", "mysql", "decimal(10,0)", CategoryInteger},
		{"mysql decimal", "mysql", "decimal(10,2)", CategoryDecimal},
		{"mysql geometry unsupported", "mysql", "geometry", CategoryUnsupported},
		{"pg timestamptz", "postgres", "timestamp(6) with time zone", CategoryDateTime},
		{"pg varchar", "kingbase", "character varying(64)", CategoryString},
		{"pg int8 is bigint", "postgres", "int8", CategoryInteger},
		{"pg array unsupported", "postgres", "integer[]", CategoryUnsupported},
		{"pg jsonb", "opengauss", "jsonb", CategoryJSON},
		{"pg uuid", "postgres", "uuid", CategoryUUID},
		{"pg inet", "postgres", "inet", CategoryInet},
		{"pg user enum unknown", "postgres", "mood", CategoryUnsupported},
		{"oracle date has time", "oracle", "DATE", CategoryDateTime},
		{"dameng date is date only", "dameng", "DATE", CategoryDate},
		{"oracle number(10) integer", "oracle", "NUMBER(10)", CategoryInteger},
		{"oracle number(*,0) integer", "oracle", "NUMBER(*,0)", CategoryInteger},
		{"oracle number plain decimal", "oracle", "NUMBER", CategoryDecimal},
		{"oracle varchar2 byte", "oracle", "VARCHAR2(100 BYTE)", CategoryString},
		{"oracle long is text", "oracle", "LONG", CategoryText},
		{"oracle timestamp local tz", "oracle", "TIMESTAMP(6) WITH LOCAL TIME ZONE", CategoryDateTime},
		{"sqlserver rowversion", "sqlserver", "timestamp", CategoryUnsupported},
		{"sqlserver bit is bool", "sqlserver", "bit", CategoryBoolean},
		{"sqlserver nvarchar max", "sqlserver", "nvarchar(max)", CategoryString},
		{"sqlserver uniqueidentifier", "sqlserver", "uniqueidentifier", CategoryUUID},
		{"clickhouse nullable uint8", "clickhouse", "Nullable(UInt8)", CategoryInteger},
		{"clickhouse int8 is 8-bit int", "clickhouse", "Int8", CategoryInteger},
		{"clickhouse lowcardinality string", "clickhouse", "LowCardinality(String)", CategoryText},
		{"clickhouse enum8", "clickhouse", "Enum8('a' = 1, 'b' = 2)", CategoryEnum},
		{"clickhouse datetime64 tz", "clickhouse", "DateTime64(3, 'Asia/Shanghai')", CategoryDateTime},
		{"clickhouse array", "clickhouse", "Array(String)", CategoryUnsupported},
		{"tdengine binary is string", "tdengine", "BINARY(20)", CategoryString},
		{"sqlite untyped", "sqlite", "", CategoryText},
		{"informix datetime", "gbase8s", "datetime year to second", CategoryDateTime},
		{"firebird text blob", "firebird", "BLOB SUB_TYPE TEXT", CategoryText},
		{"duckdb utinyint", "duckdb", "UTINYINT", CategoryInteger},
		{"questdb long", "questdb", "LONG", CategoryInteger},
		{"questdb symbol", "questdb", "SYMBOL", CategoryString},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveCategory(ResolveFamily(tc.dialect), parseColumnType(tc.typ))
			if got != tc.want {
				t.Fatalf("resolveCategory(%s, %q) = %s, want %s", tc.dialect, tc.typ, got, tc.want)
			}
		})
	}
}

func TestClassifyColumnShape(t *testing.T) {
	cases := []struct {
		name    string
		dialect string
		typ     string
		check   func(t *testing.T, p Profile)
	}{
		{"mysql tinyint unsigned range", "mysql", "tinyint(3) unsigned", func(t *testing.T, p Profile) {
			expectBounds(t, p, "0", "255")
		}},
		{"sqlserver tinyint is unsigned", "sqlserver", "tinyint", func(t *testing.T, p Profile) {
			expectBounds(t, p, "0", "255")
		}},
		{"clickhouse int8 is 8-bit", "clickhouse", "Int8", func(t *testing.T, p Profile) {
			expectBounds(t, p, "-128", "127")
		}},
		{"pg int8 is 64-bit", "postgres", "int8", func(t *testing.T, p Profile) {
			expectBounds(t, p, "-9223372036854775808", "9223372036854775807")
		}},
		{"oracle number(5) bounds", "oracle", "NUMBER(5)", func(t *testing.T, p Profile) {
			expectBounds(t, p, "-99999", "99999")
		}},
		{"decimal(5,2) bounds", "postgres", "numeric(5,2)", func(t *testing.T, p Profile) {
			expectBounds(t, p, "-999.99", "999.99")
			if p.Scale != 2 {
				t.Fatalf("scale = %d", p.Scale)
			}
		}},
		{"mysql timestamp 2038", "mysql", "timestamp", func(t *testing.T, p Profile) {
			expectBounds(t, p, "1970-01-01 00:00:01", "2038-01-19 03:14:07")
		}},
		{"oracle varchar2 counts bytes", "oracle", "VARCHAR2(30)", func(t *testing.T, p Profile) {
			if p.MaxLength != 30 || !p.LengthInBytes {
				t.Fatalf("got %d inBytes=%v", p.MaxLength, p.LengthInBytes)
			}
		}},
		{"oracle varchar2 char semantics", "oracle", "VARCHAR2(30 CHAR)", func(t *testing.T, p Profile) {
			if p.MaxLength != 30 || p.LengthInBytes {
				t.Fatalf("got %d inBytes=%v", p.MaxLength, p.LengthInBytes)
			}
		}},
		{"oracle nvarchar2 counts chars", "oracle", "NVARCHAR2(30)", func(t *testing.T, p Profile) {
			if p.LengthInBytes {
				t.Fatal("NVARCHAR2 should count characters")
			}
		}},
		{"sqlserver varchar is ascii only", "sqlserver", "varchar(50)", func(t *testing.T, p Profile) {
			if !p.ASCIIOnly || !p.LengthInBytes {
				t.Fatalf("asciiOnly=%v inBytes=%v", p.ASCIIOnly, p.LengthInBytes)
			}
		}},
		{"sqlserver nvarchar keeps unicode", "sqlserver", "nvarchar(50)", func(t *testing.T, p Profile) {
			if p.ASCIIOnly || p.LengthInBytes {
				t.Fatalf("asciiOnly=%v inBytes=%v", p.ASCIIOnly, p.LengthInBytes)
			}
		}},
		{"mysql varchar counts chars", "mysql", "varchar(20)", func(t *testing.T, p Profile) {
			if p.MaxLength != 20 || p.LengthInBytes {
				t.Fatalf("got %d inBytes=%v", p.MaxLength, p.LengthInBytes)
			}
		}},
		{"mysql enum labels with quote", "mysql", "enum('a','it''s','c,d')", func(t *testing.T, p Profile) {
			if !slices.Equal(p.EnumValues, []string{"a", "it's", "c,d"}) {
				t.Fatalf("labels = %#v", p.EnumValues)
			}
		}},
		{"clickhouse enum labels", "clickhouse", "Enum8('on' = 1, 'off' = 0)", func(t *testing.T, p Profile) {
			if !slices.Equal(p.EnumValues, []string{"on", "off"}) {
				t.Fatalf("labels = %#v", p.EnumValues)
			}
		}},
		{"bit width", "postgres", "bit(4)", func(t *testing.T, p Profile) {
			if p.MaxLength != 4 {
				t.Fatalf("width = %d", p.MaxLength)
			}
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			profile := classifyColumn(ResolveFamily(tc.dialect), connection.ColumnDefinition{Name: "c", Type: tc.typ, Nullable: "YES"})
			tc.check(t, profile)
		})
	}
}

func expectBounds(t *testing.T, p Profile, low, high string) {
	t.Helper()
	if p.Min != low || p.Max != high {
		t.Fatalf("bounds = [%s, %s], want [%s, %s]", p.Min, p.Max, low, high)
	}
}

func TestClassifyAutoIncrementAndComputed(t *testing.T) {
	nextval := "nextval('t_id_seq'::regclass)"
	cases := []struct {
		name         string
		dialect      string
		column       connection.ColumnDefinition
		wantAuto     bool
		wantComputed bool
	}{
		{"mysql auto_increment", "mysql", connection.ColumnDefinition{Type: "int", Extra: "auto_increment"}, true, false},
		{"mysql default_generated is not computed", "mysql", connection.ColumnDefinition{Type: "datetime", Extra: "DEFAULT_GENERATED on update CURRENT_TIMESTAMP"}, false, false},
		{"mysql stored generated", "mysql", connection.ColumnDefinition{Type: "int", Extra: "STORED GENERATED"}, false, true},
		{"pg nextval default", "postgres", connection.ColumnDefinition{Type: "integer", Default: &nextval}, true, false},
		{"sqlserver identity", "sqlserver", connection.ColumnDefinition{Type: "int", Extra: "auto_increment"}, true, false},
		{"sqlserver rowversion", "sqlserver", connection.ColumnDefinition{Type: "rowversion"}, false, true},
		{"clickhouse materialized", "clickhouse", connection.ColumnDefinition{Type: "UInt32", Extra: "MATERIALIZED"}, false, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			tc.column.Name = "c"
			profile := classifyColumn(ResolveFamily(tc.dialect), tc.column)
			if profile.AutoIncrement != tc.wantAuto || profile.Computed != tc.wantComputed {
				t.Fatalf("auto=%v computed=%v", profile.AutoIncrement, profile.Computed)
			}
		})
	}
}

func TestClassifyTableKeys(t *testing.T) {
	columns := []connection.ColumnDefinition{
		{Name: "order_id", Type: "bigint", Nullable: "NO"},
		{Name: "line_no", Type: "int", Nullable: "NO"},
		{Name: "sku", Type: "varchar(32)", Nullable: "NO"},
		{Name: "email", Type: "varchar(64)", Nullable: "YES", Key: "UNI"},
	}
	keys := TableKeys{
		PrimaryKey:  []string{"order_id", "line_no"},
		ForeignKeys: map[string]ForeignKey{"order_id": {Table: "orders", Column: "id"}},
	}
	profiles := ClassifyTable(FamilyMySQL, columns, keys)
	if !profiles[0].PrimaryKey || !profiles[1].PrimaryKey {
		t.Fatal("composite primary key columns should be marked")
	}
	if profiles[0].Unique {
		t.Fatal("foreign key column must not be the uniqueness anchor")
	}
	if !profiles[1].Unique {
		t.Fatal("line_no should anchor uniqueness of the composite key")
	}
	if profiles[0].ForeignKey == nil || profiles[0].ForeignKey.Table != "orders" {
		t.Fatalf("foreign key = %#v", profiles[0].ForeignKey)
	}
	if !profiles[3].Unique {
		t.Fatal("UNI key should mark the column unique")
	}
	if !profiles[2].Required() || profiles[3].Required() {
		t.Fatal("required flags are wrong")
	}
}
