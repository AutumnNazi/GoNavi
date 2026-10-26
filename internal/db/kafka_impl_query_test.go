//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"reflect"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"

	kafka "github.com/segmentio/kafka-go"
)

func TestParseKafkaSQLStartKeywordAndTail(t *testing.T) {
	for _, tc := range []struct {
		name          string
		sql           string
		defaultLatest bool
		wantLatest    bool
		wantTopic     string
		wantLimit     int
		wantOffset    int
	}{
		{name: "LATEST overrides earliest default", sql: `SELECT timestamp, partition, offset, key, value_size FROM "orders" LATEST LIMIT 100;`, wantLatest: true, wantTopic: "orders", wantLimit: 100},
		{name: "EARLIEST overrides latest default", sql: `CONSUME FROM "orders" EARLIEST LIMIT 10`, defaultLatest: true, wantTopic: "orders", wantLimit: 10},
		{name: "topic name containing latest", sql: `SELECT * FROM "latest-events" LIMIT 5`, wantTopic: "latest-events", wantLimit: 5},
		{name: "unquoted topic named latest", sql: `SELECT * FROM latest LIMIT 5`, wantTopic: "latest", wantLimit: 5},
		{name: "OFFSET only read after the topic", sql: `SELECT offset, key FROM "orders" LIMIT 5 OFFSET 3`, wantTopic: "orders", wantLimit: 5, wantOffset: 3},
		{name: "no keyword keeps connection default", sql: `SELECT * FROM "orders"`, defaultLatest: true, wantLatest: true, wantTopic: "orders", wantLimit: defaultKafkaPreviewLimit},
	} {
		t.Run(tc.name, func(t *testing.T) {
			parsed, ok := parseKafkaSQL(tc.sql, tc.defaultLatest)
			if !ok {
				t.Fatalf("parse failed: %s", tc.sql)
			}
			if parsed.Latest != tc.wantLatest || parsed.Topic != tc.wantTopic || parsed.Limit != tc.wantLimit || parsed.Offset != tc.wantOffset {
				t.Fatalf("parsed = %+v", parsed)
			}
		})
	}
}

func TestParseKafkaColumnList(t *testing.T) {
	for _, tc := range []struct {
		raw  string
		want []string
	}{
		{raw: "timestamp, PARTITION", want: []string{"timestamp", "partition"}},
		{raw: "offset, value.orderId", want: []string{"offset", "value.orderId"}},
		{raw: "VALUE.Data", want: []string{"value.Data"}},
		{raw: "*, offset", want: nil},
		{raw: "offset, *", want: nil},
		{raw: "\"key\", `value`", want: []string{"key", "value"}},
	} {
		if got := parseKafkaColumnList(tc.raw); !reflect.DeepEqual(got, tc.want) {
			t.Fatalf("parseKafkaColumnList(%q) = %#v, want %#v", tc.raw, got, tc.want)
		}
	}
}

func TestKafkaQueryBuildsPreviewRequest(t *testing.T) {
	partition := 2
	for _, tc := range []struct {
		name   string
		sql    string
		budget int64
		want   kafkaFetchRequest
	}{
		{
			name: "metadata list reads latest without payload",
			sql:  `SELECT timestamp, partition, offset, key, value_size FROM "orders" LATEST LIMIT 100;`,
			want: kafkaFetchRequest{Topic: "orders", Limit: 100, Latest: true, ByteBudget: kafkaDefaultPreviewByteBudget},
		},
		{
			name: "SELECT * with partition filter needs payload",
			sql:  `SELECT * FROM "orders" WHERE partition = 2 LIMIT 10`,
			want: kafkaFetchRequest{Topic: "orders", Limit: 10, Partition: &partition, IncludeValue: true, ByteBudget: kafkaPayloadByteBudget},
		},
		{
			name: "value path projection needs payload",
			sql:  `SELECT offset, value.id FROM "orders" LIMIT 3`,
			want: kafkaFetchRequest{Topic: "orders", Limit: 3, IncludeValue: true, ByteBudget: kafkaPayloadByteBudget},
		},
		{
			name:   "configured preview budget applies to metadata",
			sql:    `SELECT offset, value_size FROM "orders" LIMIT 3`,
			budget: 128 << 20,
			want:   kafkaFetchRequest{Topic: "orders", Limit: 3, ByteBudget: 128 << 20},
		},
		{
			name:   "payload budget stays capped by the agent frame",
			sql:    `SELECT * FROM "orders" LIMIT 3`,
			budget: 128 << 20,
			want:   kafkaFetchRequest{Topic: "orders", Limit: 3, IncludeValue: true, ByteBudget: kafkaPayloadByteBudget},
		},
		{
			name: "CONSUME uses the connection group",
			sql:  `CONSUME FROM "orders" LIMIT 3`,
			want: kafkaFetchRequest{Topic: "orders", Limit: 3, GroupID: "analytics", IncludeValue: true, ByteBudget: kafkaPayloadByteBudget},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			runtime := &fakeKafkaRuntime{}
			client := &KafkaDB{runtime: runtime, defaultGroup: "analytics", previewBudget: tc.budget}
			if _, _, err := client.Query(tc.sql); err != nil {
				t.Fatalf("query: %v", err)
			}
			if !reflect.DeepEqual(runtime.lastFetchRequest, tc.want) {
				t.Fatalf("request = %+v, want %+v", runtime.lastFetchRequest, tc.want)
			}
		})
	}
}

func TestKafkaQueryReportsTruncatedPreview(t *testing.T) {
	runtime := &fakeKafkaRuntime{
		fetchTruncated: true,
		fetchResult: []kafkaMessageRecord{
			{Message: kafka.Message{Topic: "orders", Offset: 1}, ValueSize: 40 << 20},
			{Message: kafka.Message{Topic: "orders", Offset: 2}, ValueSize: 40 << 20},
		},
	}
	client := &KafkaDB{runtime: runtime}
	rows, _, messages, err := client.QueryContextWithMessages(context.Background(), `SELECT offset, value_size FROM "orders" LATEST LIMIT 100`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if len(rows) != 2 || len(messages) != 1 {
		t.Fatalf("rows=%d messages=%v", len(rows), messages)
	}
	gotRows, budget, ok := ParseKafkaPreviewTruncatedNotice(messages[0])
	if !ok || gotRows != 2 || budget != kafkaDefaultPreviewByteBudget {
		t.Fatalf("notice = %q", messages[0])
	}
	runtime.fetchTruncated = false
	if _, _, messages, _ = client.QueryContextWithMessages(context.Background(), `SELECT offset FROM "orders"`); len(messages) != 0 {
		t.Fatalf("complete preview must not carry a notice: %v", messages)
	}
}

func TestKafkaQueryLocatorLooksUpExactOffset(t *testing.T) {
	runtime := &fakeKafkaRuntime{}
	client := &KafkaDB{runtime: runtime}
	rows, columns, err := client.Query(`SELECT * FROM "orders" WHERE partition = 1 AND offset = 9 LIMIT 1`)
	if err != nil {
		t.Fatalf("query: %v", err)
	}
	if runtime.fetchAtCount != 1 || runtime.fetchCount != 0 {
		t.Fatalf("fetchAt=%d fetch=%d", runtime.fetchAtCount, runtime.fetchCount)
	}
	if runtime.lastFetchAtTopic != "orders" || runtime.lastFetchAtPartition != 1 || runtime.lastFetchAtOffset != 9 {
		t.Fatalf("locator = %s[%d]@%d", runtime.lastFetchAtTopic, runtime.lastFetchAtPartition, runtime.lastFetchAtOffset)
	}
	if len(rows) != 0 || len(columns) != 0 {
		t.Fatalf("missing message must return an empty result, got %v %v", rows, columns)
	}

	if _, _, err := client.Query(`SELECT * FROM "orders" WHERE offset = 5`); err == nil || !strings.Contains(err.Error(), "partition") {
		t.Fatalf("offset without partition must fail with a hint, got %v", err)
	}
}

func TestKafkaMessageRowsProjectsRequestedValuePaths(t *testing.T) {
	record := kafkaMessageRecord{
		Message:   kafka.Message{Topic: "orders", Offset: 3},
		Value:     map[string]interface{}{"orderId": 7, "Nested": map[string]interface{}{"Deep": "x"}},
		ValueSize: kafkaFlattenMaxPayloadBytes + 1,
	}
	rows := kafkaMessageRowsProjected([]kafkaMessageRecord{record}, []string{"offset", "value.orderId", "value.Nested.Deep"})
	want := map[string]interface{}{"offset": int64(3), "value.orderId": 7, "value.Nested.Deep": "x"}
	if len(rows) != 1 || !reflect.DeepEqual(rows[0], want) {
		t.Fatalf("rows = %#v, want %#v", rows, want)
	}
}

func TestKafkaCountRespectsPartitionFilter(t *testing.T) {
	runtime := &fakeKafkaRuntime{describeResult: kafkaTopicDescription{Name: "orders", Partitions: []kafkaTopicPartition{
		{ID: 0, ApproximateCount: 5},
		{ID: 1, ApproximateCount: 7},
	}}}
	client := &KafkaDB{runtime: runtime}
	for sql, want := range map[string]int64{
		`SELECT COUNT(*) FROM "orders"`:                     12,
		`SELECT COUNT(*) FROM "orders" WHERE partition = 1`: 7,
	} {
		rows, _, err := client.Query(sql)
		if err != nil || len(rows) != 1 || rows[0]["total"] != want {
			t.Fatalf("%s = %v (%v), want %d", sql, rows, err, want)
		}
	}
	if _, _, err := client.Query(`SELECT COUNT(*) FROM "orders" WHERE partition = 9`); err == nil {
		t.Fatal("unknown partition must fail")
	}
}

func TestKafkaPreviewByteBudgetParam(t *testing.T) {
	for params, want := range map[string]int64{
		"":                 kafkaDefaultPreviewByteBudget,
		"previewMaxMB=128": 128 << 20,
		"preview_max_mb=8": 8 << 20,
		"previewMaxMB=abc": kafkaDefaultPreviewByteBudget,
		"previewMaxMB=-1":  kafkaDefaultPreviewByteBudget,
	} {
		if got := kafkaPreviewByteBudget(connection.ConnectionConfig{ConnectionParams: params}); got != want {
			t.Fatalf("kafkaPreviewByteBudget(%q) = %d, want %d", params, got, want)
		}
	}
}
