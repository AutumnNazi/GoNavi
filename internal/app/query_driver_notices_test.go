package app

import (
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func TestLocalizeDriverNoticesRendersKafkaTruncation(t *testing.T) {
	app := NewApp()
	messages := app.localizeDriverNotices([]string{
		"PRINT from SQL Server",
		db.FormatKafkaPreviewTruncatedNotice(4, 64<<20),
	})
	if len(messages) != 2 || messages[0] != "PRINT from SQL Server" {
		t.Fatalf("messages = %#v", messages)
	}
	if strings.Contains(messages[1], "gonavi:notice") || !strings.Contains(messages[1], "4") || !strings.Contains(messages[1], "64 MiB") {
		t.Fatalf("kafka notice not localized: %q", messages[1])
	}
	if got := app.localizeDriverNotices(nil); got != nil {
		t.Fatalf("nil messages = %#v", got)
	}
	plain := []string{"a", "b"}
	if got := app.localizeDriverNotices(plain); !reflect.DeepEqual(got, plain) || &got[0] != &plain[0] {
		t.Fatalf("plain messages should be returned as-is: %#v", got)
	}
}

// 查询编辑器（DBQueryMulti 等）把提示放在各结果集里，也要在入口返回前替换掉标记。
func TestLocalizeQueryResultNoticesCoversResultSets(t *testing.T) {
	app := NewApp()
	marker := db.FormatKafkaPreviewTruncatedNotice(10, 64<<20)
	multi := connection.QueryResult{
		Success:  true,
		Messages: []string{marker},
		Data: []connection.ResultSetData{
			{Messages: []string{"PRINT 1"}},
			{Messages: []string{marker}},
		},
	}
	app.localizeQueryResultNotices(&multi)
	sets := multi.Data.([]connection.ResultSetData)
	for _, got := range []string{multi.Messages[0], sets[1].Messages[0]} {
		if strings.Contains(got, "gonavi:notice") || !strings.Contains(got, "64 MiB") {
			t.Fatalf("marker leaked to the UI: %q", got)
		}
	}
	if sets[0].Messages[0] != "PRINT 1" {
		t.Fatalf("plain driver message changed: %q", sets[0].Messages[0])
	}

	single := connection.QueryResult{Success: true, Data: []map[string]interface{}{{"a": 1}}, Messages: []string{marker}}
	app.localizeQueryResultNotices(&single)
	if strings.Contains(single.Messages[0], "gonavi:notice") {
		t.Fatalf("single-result marker leaked: %q", single.Messages[0])
	}
	app.localizeQueryResultNotices(nil)
}
