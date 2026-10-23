//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	kafka "github.com/segmentio/kafka-go"
)

// fakeKafkaLogRecord / fakeKafkaLogBatch 模拟 broker 磁盘上的 record batch。
type fakeKafkaLogRecord struct {
	offset int64
	key    []byte
	value  []byte
}

type fakeKafkaLogBatch struct {
	records []fakeKafkaLogRecord
	// last 是 batch 覆盖的最后一个 offset：压缩后可以大于最后一条记录的 offset。
	last    int64
	control bool
}

func (b fakeKafkaLogBatch) wireSize() int64 {
	size := int64(61)
	for _, record := range b.records {
		size += int64(len(record.key) + len(record.value) + 20)
	}
	return size
}

// fakeKafkaLog 按真实 broker 的规则响应 fetch：从包含 offset 的 batch 开始，第一个 batch
// 总是返回（KIP-74），之后的 batch 在 MaxBytes 内才返回；控制 batch 由客户端过滤。
type fakeKafkaLog struct {
	batches  []fakeKafkaLogBatch
	hwm      int64
	fetches  []int64
	maxBytes []int64
}

func (l *fakeKafkaLog) fetchPartition(ctx context.Context, request kafkaPartitionFetch) (kafkaPartitionBatch, error) {
	if err := ctx.Err(); err != nil {
		return kafkaPartitionBatch{}, err
	}
	l.fetches = append(l.fetches, request.Offset)
	l.maxBytes = append(l.maxBytes, request.MaxBytes)
	var records []kafka.Record
	var used int64
	started := false
	for _, batch := range l.batches {
		if !started && batch.last < request.Offset {
			continue
		}
		if started && used+batch.wireSize() > request.MaxBytes {
			break
		}
		started = true
		used += batch.wireSize()
		if batch.control {
			continue
		}
		for _, record := range batch.records {
			records = append(records, kafka.Record{
				Offset: record.offset,
				Time:   time.UnixMilli(1_700_000_000_000 + record.offset),
				Key:    kafka.NewBytes(record.key),
				Value:  kafka.NewBytes(record.value),
			})
		}
	}
	return kafkaPartitionBatch{HighWatermark: l.hwm, Records: kafka.NewRecordReader(records...)}, nil
}

// newFakeKafkaLog 生成 count 条单记录 batch，offset 从 first 开始。
func newFakeKafkaLog(first int64, count int, valueSize int) *fakeKafkaLog {
	log := &fakeKafkaLog{hwm: first + int64(count)}
	for i := 0; i < count; i++ {
		offset := first + int64(i)
		value := make([]byte, valueSize)
		log.batches = append(log.batches, fakeKafkaLogBatch{
			records: []fakeKafkaLogRecord{{offset: offset, key: []byte(fmt.Sprintf("k%d", offset)), value: value}},
			last:    offset,
		})
	}
	return log
}

func kafkaRecordOffsets(records []kafkaMessageRecord) []int64 {
	offsets := make([]int64, 0, len(records))
	for _, record := range records {
		offsets = append(offsets, record.Message.Offset)
	}
	return offsets
}

func TestReadKafkaPartitionLoop(t *testing.T) {
	compactedTail := &fakeKafkaLog{hwm: 9, batches: []fakeKafkaLogBatch{
		{records: []fakeKafkaLogRecord{{offset: 0}, {offset: 1}, {offset: 2}}, last: 6},
		{records: []fakeKafkaLogRecord{{offset: 7}, {offset: 8}}, last: 8},
	}}
	trailingMarker := &fakeKafkaLog{hwm: 6, batches: []fakeKafkaLogBatch{
		{records: []fakeKafkaLogRecord{{offset: 0}, {offset: 1}, {offset: 2}, {offset: 3}, {offset: 4}}, last: 4},
		{records: []fakeKafkaLogRecord{{offset: 5, key: []byte{0, 0, 0, 1}, value: []byte{0, 0, 0, 0, 0, 0}}}, last: 5, control: true},
	}}
	compactedTarget := &fakeKafkaLog{hwm: 6, batches: []fakeKafkaLogBatch{
		{records: []fakeKafkaLogRecord{{offset: 0}, {offset: 1}}, last: 4},
		{records: []fakeKafkaLogRecord{{offset: 5}}, last: 5},
	}}
	for _, tc := range []struct {
		name          string
		log           *fakeKafkaLog
		window        kafkaPartitionWindow
		wantOffsets   []int64
		wantTruncated bool
		wantFetches   []int64
	}{
		{
			// 读到起始时的 high-water mark 即停，不再发一次空等 MaxWait 的 fetch；
			// 起点是分区保留的最早 offset，而不是 0。
			name:        "stops at high-water mark without idle fetch",
			log:         newFakeKafkaLog(100, 10, 16),
			window:      kafkaPartitionWindow{Start: 100, End: 110, Target: 100},
			wantOffsets: []int64{100, 101, 102, 103, 104, 105, 106, 107, 108, 109},
			wantFetches: []int64{100},
		},
		{
			name:          "earliest stops once the byte budget is used",
			log:           newFakeKafkaLog(0, 20, 600),
			window:        kafkaPartitionWindow{Start: 0, End: 20, Target: 100, Budget: 6000},
			wantOffsets:   []int64{0, 1, 2, 3, 4, 5, 6, 7, 8, 9},
			wantTruncated: true,
			wantFetches:   []int64{0, 8, 9},
		},
		{
			name:          "latest keeps the newest messages within budget",
			log:           newFakeKafkaLog(0, 12, 600),
			window:        kafkaPartitionWindow{Start: 0, End: 12, Target: 100, Latest: true, Budget: 3000},
			wantOffsets:   []int64{8, 9, 10, 11},
			wantTruncated: true,
			wantFetches:   []int64{0},
		},
		{
			// 窗口装不下时按平均体积直接跳到尾部，而不是把 20 条大消息逐条传完。
			name:          "latest jumps to the tail instead of reading the whole window",
			log:           newFakeKafkaLog(0, 20, 600),
			window:        kafkaPartitionWindow{Start: 0, End: 20, Target: 100, Latest: true, Budget: 1500, FetchBytes: 1},
			wantOffsets:   []int64{18, 19},
			wantTruncated: true,
			wantFetches:   []int64{0, 18, 19},
		},
		{
			// 事务 topic 末尾是 commit marker：控制 batch 被过滤后没有新记录，前进一位即结束。
			name:        "skips trailing transaction marker",
			log:         trailingMarker,
			window:      kafkaPartitionWindow{Start: 0, End: 6, Target: 100},
			wantOffsets: []int64{0, 1, 2, 3, 4},
			wantFetches: []int64{0, 5},
		},
		{
			// 压缩后 batch 尾部是空洞：同一个 batch 会被重复返回，必须逐位前进而不是死循环。
			name:        "advances through a compacted batch tail",
			log:         compactedTail,
			window:      kafkaPartitionWindow{Start: 0, End: 9, Target: 100, FetchBytes: 1},
			wantOffsets: []int64{0, 1, 2, 7, 8},
			wantFetches: []int64{0, 3, 4, 5, 6, 7},
		},
		{
			// 详情定位只接受 offset 完全相等的消息：被压实的 offset 不能返回后面那条。
			name:        "exact offset window ignores later messages",
			log:         compactedTarget,
			window:      kafkaPartitionWindow{Start: 3, End: 4, Target: 1, FetchBytes: kafkaDetailFetchMaxBytes},
			wantOffsets: []int64{},
			wantFetches: []int64{3},
		},
	} {
		t.Run(tc.name, func(t *testing.T) {
			tc.window.Topic = "orders"
			records, truncated, err := readKafkaPartition(context.Background(), tc.log, tc.window)
			if err != nil {
				t.Fatalf("readKafkaPartition: %v", err)
			}
			if got := kafkaRecordOffsets(records); !reflect.DeepEqual(got, tc.wantOffsets) {
				t.Fatalf("offsets = %v, want %v", got, tc.wantOffsets)
			}
			if truncated != tc.wantTruncated {
				t.Fatalf("truncated = %v, want %v", truncated, tc.wantTruncated)
			}
			if !reflect.DeepEqual(tc.log.fetches, tc.wantFetches) {
				t.Fatalf("fetches = %v, want %v", tc.log.fetches, tc.wantFetches)
			}
		})
	}
}

func TestReadKafkaPartitionGivesUpAfterTooManyStalledFetches(t *testing.T) {
	log := &fakeKafkaLog{hwm: 1001, batches: []fakeKafkaLogBatch{
		{records: []fakeKafkaLogRecord{{offset: 0}}, last: 1000},
	}}
	records, _, err := readKafkaPartition(context.Background(), log, kafkaPartitionWindow{
		Topic: "orders", Start: 0, End: 1001, Target: 100, FetchBytes: 1,
	})
	if err != nil {
		t.Fatalf("readKafkaPartition: %v", err)
	}
	if len(records) != 1 {
		t.Fatalf("records = %v", kafkaRecordOffsets(records))
	}
	if want := 1 + kafkaMaxStalledFetches + 1; len(log.fetches) != want {
		t.Fatalf("fetches = %d, want %d", len(log.fetches), want)
	}
}

// 大消息分区：首个 16 MiB 响应确认平均体积后，改为每次只取一个 batch，
// 避免每次多传一个被丢弃的半截 batch（e2e：64 MiB 预算实际传了 86 MiB）。
func TestReadKafkaPartitionFetchesLargeMessagesOneBatchAtATime(t *testing.T) {
	const valueSize = 6 << 20
	shared := make([]byte, valueSize) // 所有记录共用一份 payload，测试只关心体积
	largeLog := func(count int) *fakeKafkaLog {
		log := &fakeKafkaLog{hwm: int64(count)}
		for i := 0; i < count; i++ {
			log.batches = append(log.batches, fakeKafkaLogBatch{
				records: []fakeKafkaLogRecord{{offset: int64(i), key: []byte(fmt.Sprintf("k%d", i)), value: shared}},
				last:    int64(i),
			})
		}
		return log
	}
	offsetRange := func(from, to int64) []int64 {
		offsets := []int64{}
		for offset := from; offset < to; offset++ {
			offsets = append(offsets, offset)
		}
		return offsets
	}
	for _, tc := range []struct {
		name        string
		count       int
		latest      bool
		wantOffsets []int64
		wantFetches []int64
	}{
		{"earliest", 12, false, offsetRange(0, 11), append([]int64{0}, offsetRange(2, 11)...)},
		{"latest", 12, true, offsetRange(2, 12), append([]int64{0}, offsetRange(2, 12)...)},
		// 跳到尾部会清空已读记录，单 batch 模式必须保留。
		{"latest after jumping to the tail", 40, true, offsetRange(30, 40), append([]int64{0}, offsetRange(30, 40)...)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			log := largeLog(tc.count)
			records, truncated, err := readKafkaPartition(context.Background(), log, kafkaPartitionWindow{
				Topic: "orders", Start: 0, End: int64(tc.count), Target: 100, Latest: tc.latest, Budget: 64 << 20,
			})
			if err != nil {
				t.Fatalf("readKafkaPartition: %v", err)
			}
			if got := kafkaRecordOffsets(records); !reflect.DeepEqual(got, tc.wantOffsets) || !truncated {
				t.Fatalf("offsets = %v truncated=%v, want %v truncated", got, truncated, tc.wantOffsets)
			}
			if !reflect.DeepEqual(log.fetches, tc.wantFetches) {
				t.Fatalf("fetches = %v, want %v", log.fetches, tc.wantFetches)
			}
			if log.maxBytes[0] != kafkaFetchMaxBytes {
				t.Fatalf("first fetch MaxBytes = %d, want %d", log.maxBytes[0], kafkaFetchMaxBytes)
			}
			for i, maxBytes := range log.maxBytes[1:] {
				if maxBytes != kafkaDetailFetchMaxBytes {
					t.Fatalf("fetch #%d MaxBytes = %d, want one batch (%d)", i+1, maxBytes, kafkaDetailFetchMaxBytes)
				}
			}
		})
	}
}

func TestReadKafkaPartitionHonoursCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	log := newFakeKafkaLog(0, 5, 16)
	_, _, err := readKafkaPartition(ctx, log, kafkaPartitionWindow{Topic: "orders", Start: 0, End: 5, Target: 5})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if len(log.fetches) != 0 {
		t.Fatalf("canceled read still fetched %v", log.fetches)
	}
}

func TestKafkaRecordToMessageSkipsPayloadForMetadata(t *testing.T) {
	newRecord := func() *kafka.Record {
		return &kafka.Record{
			Offset:  7,
			Time:    time.UnixMilli(1_700_000_000_123).In(time.FixedZone("UTC+8", 8*3600)),
			Key:     kafka.NewBytes([]byte(`{"tenant":"a"}`)),
			Value:   kafka.NewBytes([]byte(`{"big":"payload"}`)),
			Headers: []kafka.Header{{Key: "x-env", Value: []byte("dev")}},
		}
	}
	metadata, err := kafkaRecordToMessage("orders", 2, 9, newRecord(), false)
	if err != nil {
		t.Fatalf("metadata: %v", err)
	}
	if metadata.Message.Value != nil || metadata.ValueSize != len(`{"big":"payload"}`) {
		t.Fatalf("metadata read must keep only the size: value=%q size=%d", metadata.Message.Value, metadata.ValueSize)
	}
	if key, ok := metadata.Key.(map[string]interface{}); !ok || key["tenant"] != "a" {
		t.Fatalf("key = %#v", metadata.Key)
	}
	if metadata.Headers["x-env"] != "dev" || metadata.Message.Partition != 2 || metadata.Message.HighWaterMark != 9 {
		t.Fatalf("unexpected metadata record: %#v", metadata)
	}
	if metadata.Message.Time.Location() != time.UTC || metadata.Message.Time.UnixMilli() != 1_700_000_000_123 {
		t.Fatalf("time = %v, want UTC", metadata.Message.Time)
	}

	full, err := kafkaRecordToMessage("orders", 2, 9, newRecord(), true)
	if err != nil {
		t.Fatalf("full: %v", err)
	}
	if string(full.Message.Value) != `{"big":"payload"}` || full.Value != nil {
		t.Fatalf("full read copies bytes but defers decoding: value=%q decoded=%#v", full.Message.Value, full.Value)
	}

	noTime := newRecord()
	noTime.Time = time.UnixMilli(0)
	zero, err := kafkaRecordToMessage("orders", 0, 1, noTime, false)
	if err != nil || !zero.Message.Time.IsZero() {
		t.Fatalf("non-positive timestamp should be unset, got %v (%v)", zero.Message.Time, err)
	}
}

func TestKafkaFetchHelpers(t *testing.T) {
	for _, tc := range []struct {
		total      int64
		partitions int
		want       int64
	}{
		{64 << 20, 1, 64 << 20},
		{64 << 20, 4, 16 << 20},
		{64 << 20, 200, 1 << 20},
		{0, 5, 0},
	} {
		if got := kafkaPartitionBudget(tc.total, tc.partitions); got != tc.want {
			t.Fatalf("kafkaPartitionBudget(%d, %d) = %d, want %d", tc.total, tc.partitions, got, tc.want)
		}
	}

	records := make([]kafkaMessageRecord, 5)
	for i := range records {
		records[i] = kafkaMessageRecord{Message: kafka.Message{Offset: int64(i)}, ValueSize: 10}
	}
	if got := kafkaRecordOffsets(kafkaPaginateRecords(records, 1, 2)); !reflect.DeepEqual(got, []int64{1, 2}) {
		t.Fatalf("paginate = %v", got)
	}
	if got := kafkaPaginateRecords(records, 10, 2); len(got) != 0 {
		t.Fatalf("paginate past end = %v", kafkaRecordOffsets(got))
	}
	if trimmed, cut := kafkaTrimRecordsToBudget(records, 25); len(trimmed) != 2 || !cut {
		t.Fatalf("trim(25) = %v, cut=%v", kafkaRecordOffsets(trimmed), cut)
	}
	if trimmed, cut := kafkaTrimRecordsToBudget(records, 5); len(trimmed) != 1 || !cut {
		t.Fatalf("trim keeps at least one record: %v, cut=%v", kafkaRecordOffsets(trimmed), cut)
	}
	if trimmed, cut := kafkaTrimRecordsToBudget(records, 0); len(trimmed) != 5 || cut {
		t.Fatalf("zero budget means unlimited: %v, cut=%v", kafkaRecordOffsets(trimmed), cut)
	}
	if start := kafkaLatestWindowStart(100, 150, 20); start != 130 {
		t.Fatalf("latest start = %d", start)
	}
	if start := kafkaLatestWindowStart(100, 110, 20); start != 100 {
		t.Fatalf("latest start must not precede the first offset: %d", start)
	}
}
