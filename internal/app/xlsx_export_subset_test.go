package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"GoNavi-Wails/internal/connection"

	"github.com/xuri/excelize/v2"
)

func TestXLSXExportSelectedSubsetKeepsOriginalDataKeys(t *testing.T) {
	columns := []string{"id", "name", "amount", "internal"}
	values := [][]interface{}{{int64(1), "alice", 12.5, "hidden"}, {int64(0), "bob", -0.1, "also hidden"}}
	rows := makeXLSXExportRows(columns, values)
	for _, route := range []string{"buffered", "fallback", "map-stream", "value-stream"} {
		t.Run(route, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "subset.xlsx")
			file, err := os.Create(path)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = file.Close() })
			options := ExportFileOptions{Format: "xlsx", Columns: []string{"amount", "name"}, ColumnComments: map[string]string{"amount": "金额", "name": "姓名"}}
			if route == "buffered" {
				err = writeRowsToFile(file, rows, columns, options)
			} else {
				var count int64
				count, _, err = exportQueryResultToFile(file, newXLSXExportSource(route, columns, rows, values), connection.ConnectionConfig{Type: "mysql"}, "SELECT * FROM fixture", options, nil)
				if count != int64(len(values)) {
					t.Errorf("exported rows = %d, want %d", count, len(values))
				}
			}
			if err != nil {
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			book, err := excelize.OpenFile(path)
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = book.Close() })
			got, err := book.GetRows("Sheet1", excelize.Options{RawCellValue: true})
			if err != nil {
				t.Fatal(err)
			}
			want := [][]string{{"金额", "姓名"}, {"12.5", "alice"}, {"-0.1", "bob"}}
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("selected subset = %#v, want %#v", got, want)
			}
		})
	}
}
