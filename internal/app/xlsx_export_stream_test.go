package app

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"

	"github.com/xuri/excelize/v2"
)

func TestXLSXExportValueStreamAcrossBufferFlush(t *testing.T) {
	const rowCount = 1200
	const rowsPerSheet = 700
	values := make([][]interface{}, 0, rowCount)
	padding := strings.Repeat("x", 300)
	for index := 0; index < rowCount; index++ {
		values = append(values, []interface{}{int64(index), fmt.Sprintf("row-%d-%s", index, padding)})
	}
	source := &fakeValueStreamExportDB{streamCols: []string{"id", "note"}, streamValues: values}
	path := filepath.Join(t.TempDir(), "large.xlsx")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })
	count, _, err := exportQueryResultToFile(file, source, connection.ConnectionConfig{Type: "mysql"}, "SELECT id, note FROM fixture", ExportFileOptions{
		Format: "xlsx", Columns: []string{"note", "id"}, XLSXMaxRowsPerSheet: rowsPerSheet,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	if count != rowCount || source.valueHits != rowCount || source.queryHits != 0 {
		t.Fatalf("rows=%d valueHits=%d queryHits=%d, want %d streamed rows without fallback", count, source.valueHits, source.queryHits, rowCount)
	}
	book, err := excelize.OpenFile(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = book.Close() })
	sheets := book.GetSheetList()
	if len(sheets) != 2 {
		t.Fatalf("sheets=%v, want two", sheets)
	}
	for index, sheet := range sheets {
		rows, err := book.GetRows(sheet, excelize.Options{RawCellValue: true})
		if err != nil {
			t.Fatal(err)
		}
		wantRows := min(rowsPerSheet, rowCount-index*rowsPerSheet) + 1
		if len(rows) != wantRows {
			t.Errorf("%s rows=%d, want %d including header", sheet, len(rows), wantRows)
		}
	}
	for index := 0; index < rowCount; index++ {
		sheet := fmt.Sprintf("Sheet%d", index/rowsPerSheet+1)
		row := index%rowsPerSheet + 2
		assertXLSXExportCell(t, book, sheet, fmt.Sprintf("A%d", row), fmt.Sprintf("row-%d-%s", index, padding), excelize.CellTypeInlineString)
		assertXLSXExportCell(t, book, sheet, fmt.Sprintf("B%d", row), fmt.Sprint(index), excelize.CellTypeNumber)
	}
}
