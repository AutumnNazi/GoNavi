//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"bytes"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestResolveHiveTargetAndURI(t *testing.T) {
	defaultTarget := resolveHiveTarget(connection.ConnectionConfig{Type: "hive"})
	if defaultTarget.host != "127.0.0.1" || defaultTarget.port != 10000 || defaultTarget.user != "hive" || defaultTarget.database != "default" {
		t.Fatalf("unexpected default target: %+v", defaultTarget)
	}

	jdbcTarget := resolveHiveTarget(connection.ConnectionConfig{
		Type: "hive",
		URI:  "jdbc:hive2://hs2.example.com:10001/dw;auth=noSasl;hive.execution.engine=tez",
	})
	if jdbcTarget.host != "hs2.example.com" || jdbcTarget.port != 10001 || jdbcTarget.database != "dw" {
		t.Fatalf("unexpected jdbc target: %+v", jdbcTarget)
	}
	if !isHiveNoSASL(jdbcTarget.params) {
		t.Fatalf("expected auth=noSasl to enable noSASL: %+v", jdbcTarget.params)
	}
	conf := buildHiveSessionConfiguration(jdbcTarget.database, jdbcTarget.params)
	if conf["use:database"] != "dw" || conf["set:hiveconf:hive.execution.engine"] != "tez" || conf["set:hiveconf:hive.resultset.use.unique.column.names"] != "false" {
		t.Fatalf("unexpected session configuration: %+v", conf)
	}

	uriTarget := resolveHiveTarget(connection.ConnectionConfig{
		Type: "hive",
		URI:  "hive://analyst:secret@10.0.0.8:10000/analytics?ssl=true&hiveconf:mapreduce.job.queuename=prod",
	})
	if uriTarget.host != "10.0.0.8" || uriTarget.user != "analyst" || uriTarget.password != "secret" || uriTarget.database != "analytics" || !uriTarget.useSSL {
		t.Fatalf("unexpected uri target: %+v", uriTarget)
	}
}

func TestParseHiveVersionAndVariants(t *testing.T) {
	cases := map[string]struct {
		version string
		variant string
	}{
		"4.0.1 r3af4517eb8cfd9407ad34ed78a0b48b57dfaa264": {version: "4.0.1", variant: "v4"},
		"3.1.3000.7.1.8.0-801 r123456":                    {version: "3.1.3000", variant: "v3"},
	}
	for banner, want := range cases {
		gotVer := parseHiveVersion(banner)
		if gotVer != want.version {
			t.Fatalf("parseHiveVersion(%q) = %q, want %q", banner, gotVer, want.version)
		}
		var state driverVariantState
		if err := state.resolve("hive", connection.ConnectionConfig{Type: "hive"}, gotVer); err != nil {
			t.Fatalf("resolve(%q): %v", gotVer, err)
		}
		gotVariant, _ := state.DriverVariantInfo()
		if gotVariant != want.variant {
			t.Fatalf("variant for %q = %q, want %q", banner, gotVariant, want.variant)
		}
	}
}

func TestParseHiveDescribeRows(t *testing.T) {
	rows := []map[string]interface{}{
		{"col_name": "order_id", "data_type": "string", "comment": "订单号"},
		{"col_name": "qty", "data_type": "int", "comment": "from deserializer"},
		{"col_name": "dt", "data_type": "string", "comment": "分区日期"},
		{"col_name": "", "data_type": nil, "comment": nil},
		{"col_name": "# Partition Information", "data_type": nil, "comment": nil},
		{"col_name": "# col_name", "data_type": "data_type", "comment": "comment"},
		{"col_name": "dt", "data_type": "string", "comment": "分区日期"},
	}
	cols := parseHiveDescribeRows(rows)
	if len(cols) != 3 {
		t.Fatalf("expected 3 columns, got %d: %#v", len(cols), cols)
	}
	if cols[0].Name != "order_id" || cols[0].Comment != "订单号" || cols[0].Extra != "" {
		t.Fatalf("unexpected first column: %#v", cols[0])
	}
	if cols[1].Name != "qty" || cols[1].Comment != "" {
		t.Fatalf("expected 'from deserializer' comment to be stripped: %#v", cols[1])
	}
	if cols[2].Name != "dt" || cols[2].Extra != "PARTITION KEY" {
		t.Fatalf("expected dt to be marked as PARTITION KEY: %#v", cols[2])
	}
}

func TestHiveBindArgsAndNormalizeStatement(t *testing.T) {
	if got := normalizeHiveStatement("SELECT * FROM `dw`.`ods_orders`; \n\t"); got != "SELECT * FROM `dw`.`ods_orders`" {
		t.Fatalf("unexpected normalized statement: %q", got)
	}
	bound, err := hiveBindArgs("/* comment ? */ SELECT * FROM `t?` WHERE note = '?' AND id = ? AND active = ? AND tag = ?", []any{42, true, "O'Reilly"})
	if err != nil {
		t.Fatalf("hiveBindArgs error: %v", err)
	}
	want := `/* comment ? */ SELECT * FROM ` + "`t?`" + ` WHERE note = '?' AND id = 42 AND active = TRUE AND tag = 'O\'Reilly'`
	if bound != want {
		t.Fatalf("hiveBindArgs = %q, want %q", bound, want)
	}
}

func TestHiveThriftColumnarRowSetDecode(t *testing.T) {
	w := newHiveWriter()
	w.writeFieldBegin(thriftTypeI64, 1) // startRowOffset
	w.writeI64(0)
	w.writeFieldBegin(thriftTypeList, 3) // columns
	w.buf.WriteByte(thriftTypeStruct)
	w.writeI32(2) // 2 columns

	// Column 0: i32Val [10, 20], second is NULL
	w.writeFieldBegin(thriftTypeStruct, 4) // i32Val
	w.writeFieldBegin(thriftTypeList, 1)
	w.buf.WriteByte(thriftTypeI32)
	w.writeI32(2)
	w.writeI32(10)
	w.writeI32(20)
	w.writeFieldBegin(thriftTypeString, 2) // nulls bitmap: row 1 is null (bit 1 -> 0x02)
	w.writeBytes([]byte{0x02})
	w.writeFieldStop()
	w.writeFieldStop()

	// Column 1: stringVal ["alpha", "beta"], none NULL
	w.writeFieldBegin(thriftTypeStruct, 7) // stringVal
	w.writeFieldBegin(thriftTypeList, 1)
	w.buf.WriteByte(thriftTypeString)
	w.writeI32(2)
	w.writeString("alpha")
	w.writeString("beta")
	w.writeFieldBegin(thriftTypeString, 2)
	w.writeBytes([]byte{0x00})
	w.writeFieldStop()
	w.writeFieldStop()

	w.writeFieldStop() // end TRowSet

	rows, err := readHiveRowSet(newHiveReader(bytes.NewReader(w.bytes())))
	if err != nil {
		t.Fatalf("readHiveRowSet error: %v", err)
	}
	if len(rows) != 2 || rows[0][0] != int64(10) || rows[0][1] != "alpha" || rows[1][0] != nil || rows[1][1] != "beta" {
		t.Fatalf("unexpected decoded rows: %#v", rows)
	}
}
