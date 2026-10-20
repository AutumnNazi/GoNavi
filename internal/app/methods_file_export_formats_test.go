package app

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/dataexport"

	"github.com/apache/arrow-go/v18/parquet"
	"github.com/apache/arrow-go/v18/parquet/file"
	"golang.org/x/text/encoding"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/unicode"
)

func TestExportCSVEncodingRowsAndQueryWiring(t *testing.T) {
	for _, source := range []string{"rows", "map stream", "value stream"} {
		for _, name := range []string{"", "utf-8", "utf-8-bom", "gbk", "gb18030", "utf-16le"} {
			t.Run(source+"/"+name, func(t *testing.T) {
				var output bytes.Buffer
				var options ExportFileOptions
				if err := json.Unmarshal([]byte(`{"format":"csv","csvEncoding":"`+name+`","columns":["name"],"columnComments":{"name":"标题"}}`), &options); err != nil {
					t.Fatal(err)
				}
				row := map[string]interface{}{"id": 7, "name": "中文"}
				var err error
				switch source {
				case "rows":
					err = writeRowsToFile(&output, []map[string]interface{}{row}, []string{"id", "name"}, options)
				case "map stream":
					db := &fakeStreamExportDB{streamCols: []string{"id", "name"}, streamData: []map[string]interface{}{row}}
					_, _, err = exportQueryResultToFile(&output, db, connection.ConnectionConfig{}, "SELECT id,name", options, nil)
					if db.streamHits != 1 || db.queryHits != 0 {
						t.Fatal("query was replayed")
					}
				case "value stream":
					db := &fakeValueStreamExportDB{streamCols: []string{"id", "name"}, streamValues: [][]interface{}{{7, "中文"}}}
					_, _, err = exportQueryResultToFile(&output, db, connection.ConnectionConfig{}, "SELECT id,name", options, nil)
				}
				if err != nil {
					t.Fatal(err)
				}
				raw := output.Bytes()
				var codec encoding.Encoding
				switch name {
				case "", "utf-8-bom":
					if !bytes.HasPrefix(raw, []byte{0xef, 0xbb, 0xbf}) {
						t.Fatal("missing default BOM")
					}
					raw = raw[3:]
				case "gbk":
					codec = simplifiedchinese.GBK
				case "gb18030":
					codec = simplifiedchinese.GB18030
				case "utf-16le":
					if !bytes.HasPrefix(raw, []byte{0xff, 0xfe}) {
						t.Fatal("missing UTF16 BOM")
					}
					raw = raw[2:]
					codec = unicode.UTF16(unicode.LittleEndian, unicode.IgnoreBOM)
				}
				if codec != nil {
					raw, err = codec.NewDecoder().Bytes(raw)
					if err != nil {
						t.Fatal(err)
					}
				}
				if string(raw) != "标题\n中文\n" {
					t.Fatalf("got %q", raw)
				}
			})
		}
	}
}

func TestExportParquetRowsAndQueryWiring(t *testing.T) {
	for _, source := range []string{"rows", "map stream", "value stream", "empty query"} {
		t.Run(source, func(t *testing.T) {
			var output bytes.Buffer
			options := ExportFileOptions{Format: "parquet", Columns: []string{"name", "id"}, CSVEncoding: "invalid-is-ignored"}
			columns := []string{"id", "name", "hidden"}
			rows := []map[string]interface{}{{"id": int64(7), "name": "中文"}, {"id": nil, "name": ""}}
			var err error
			var count int64
			switch source {
			case "rows":
				count, err = writeRowsToFileWithReporter(context.Background(), &output, rows, columns, options, nil)
			case "map stream", "empty query":
				if source == "empty query" {
					rows = nil
				}
				db := &fakeStreamExportDB{streamCols: columns, streamData: rows}
				var gotColumns []string
				count, gotColumns, err = exportQueryResultToFile(&output, db, connection.ConnectionConfig{}, "SELECT id,name", options, nil)
				if !reflect.DeepEqual(gotColumns, options.Columns) || db.streamHits != 1 || db.queryHits != 0 {
					t.Fatalf("query projection/replay %#v", gotColumns)
				}
			case "value stream":
				db := &fakeValueStreamExportDB{streamCols: columns, streamValues: [][]interface{}{{int64(7), "中文", false}, {nil, "", true}}}
				count, _, err = exportQueryResultToFile(&output, db, connection.ConnectionConfig{}, "SELECT id,name", options, nil)
			}
			if err != nil {
				t.Fatal(err)
			}
			reader, err := file.NewParquetReader(bytes.NewReader(output.Bytes()))
			if err != nil {
				t.Fatal(err)
			}
			defer reader.Close()
			if reader.NumRows() != count || reader.MetaData().Schema.Column(0).Name() != "name" || reader.MetaData().Schema.Column(1).Name() != "id" {
				t.Fatal("schema/count mismatch")
			}
			if count == 0 {
				return
			}
			chunk, err := reader.RowGroup(0).Column(0)
			if err != nil {
				t.Fatal(err)
			}
			values := make([]parquet.ByteArray, 2)
			_, n, err := chunk.(*file.ByteArrayColumnChunkReader).ReadBatch(2, values, make([]int16, 2), nil)
			if err != nil || n != 2 || string(values[0]) != "中文" || string(values[1]) != "" {
				t.Fatalf("readback %q: %v", values, err)
			}
		})
	}
}

func TestExportFormatsValidationAndRegistration(t *testing.T) {
	var output bytes.Buffer
	if err := writeRowsToFile(&output, nil, []string{"v"}, ExportFileOptions{Format: "csv", CSVEncoding: "bogus"}); !errors.Is(err, dataexport.ErrInvalidCSVEncoding) {
		t.Fatalf("invalid option: %v", err)
	}
	for _, method := range []string{"rows", "query", "table"} {
		a := &App{}
		var result connection.QueryResult
		opts := ExportFileOptions{Format: "csv", CSVEncoding: "bogus"}
		switch method {
		case "rows":
			result = a.ExportDataWithOptions(nil, []string{"v"}, "result", opts)
		case "query":
			result = a.ExportQueryWithOptions(connection.ConnectionConfig{}, "", "SELECT 1", "result", opts)
		case "table":
			result = a.ExportTableWithOptions(connection.ConnectionConfig{}, "", "t", opts)
		}
		if result.Success || result.Message == "" {
			t.Fatalf("%s did not reject before opening dialog: %#v", method, result)
		}
	}
	if exportFormatExtension("PARQUET") != ".parquet" {
		t.Fatal("format not registered")
	}
	filters := exportFileDialogFilters("parquet")
	if len(filters) != 1 || filters[0].Pattern != "*.parquet" {
		t.Fatalf("filters %#v", filters)
	}
	if got := normalizeExportTargetPath(filepath.Join(t.TempDir(), "result"), "parquet"); filepath.Ext(got) != ".parquet" {
		t.Fatal(got)
	}
	if webDownloadMIMEForFormat("csv") != "text/csv" || webDownloadMIMEForFormat("parquet") != "application/vnd.apache.parquet" {
		t.Fatal("invalid content type")
	}
}

func TestExportParquetWebQuotaAndCleanup(t *testing.T) {
	for _, limit := range []int64{20, 1 << 20} {
		t.Run(strconv.FormatInt(limit, 10), func(t *testing.T) {
			root := t.TempDir()
			budget, err := newWebTransferBudget(root, limit, ErrWebDownloadTooLarge)
			if err != nil {
				t.Fatal(err)
			}
			defer budget.abort()
			f, err := os.Create(filepath.Join(root, "result.parquet"))
			if err != nil {
				t.Fatal(err)
			}
			defer f.Close()
			managed, err := newWebTransferFile(f, budget)
			if err != nil {
				t.Fatal(err)
			}
			err = writeRowsToFile(managed, []map[string]interface{}{{"name": "中文"}}, []string{"name"}, ExportFileOptions{Format: "parquet"})
			if limit == 20 && !errors.Is(err, ErrWebDownloadTooLarge) {
				t.Fatalf("quota was bypassed: %v", err)
			}
			if limit > 20 && err != nil {
				t.Fatal(err)
			}
			entries, err := os.ReadDir(root)
			if err != nil {
				t.Fatal(err)
			}
			if len(entries) != 1 || entries[0].Name() != "result.parquet" {
				t.Fatalf("scratch remains %#v", entries)
			}
			if budget.bytes != managed.size {
				t.Fatalf("scratch quota leaked: %d output %d", budget.bytes, managed.size)
			}
		})
	}
}
