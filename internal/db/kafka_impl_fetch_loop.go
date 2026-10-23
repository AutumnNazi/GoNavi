//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"errors"
	"fmt"
	"io"
	"time"

	"GoNavi-Wails/internal/logger"

	kafka "github.com/segmentio/kafka-go"
)

const (
	// kafkaFetchMaxWait 是 broker 端凑不齐 MinBytes 时的等待上限。预览只读到起始时的
	// high-water mark 为止，正常每次 fetch 都有数据可返回，这个值只兜底异常情况。
	kafkaFetchMaxWait = 500 * time.Millisecond
	// kafkaFetchTransferBudget 是单次 fetch 的传输时限：一次响应最多 16 MiB，慢链路上
	// 需要十几秒。它只防止连接卡死，正常的结束条件是读到 high-water mark。
	kafkaFetchTransferBudget = 60 * time.Second
	// kafkaDetailFetchMaxBytes 是详情定位的单次 fetch 上限。broker 至少返回目标 batch
	// （KIP-74），上限设小可以避免把相邻的大消息一起传回来再丢掉。
	kafkaDetailFetchMaxBytes = 1 << 20
	// kafkaMaxStalledFetches 限制「fetch 成功但没有新记录」的连续次数。事务 marker
	// （控制 batch 被过滤）与压缩后 batch 尾部的空洞都会出现这种情况，每次前进 1 个 offset。
	kafkaMaxStalledFetches = 64
	// kafkaLargeRecordBytes 是「每次只取一个 batch」的平均消息体积阈值。broker 按字节截断
	// 响应，末尾不完整的 batch 由客户端丢弃：16 MiB 一次读 6 MiB 的消息，每次白传 4 MiB。
	// 消息足够大时把 MaxBytes 降到 kafkaDetailFetchMaxBytes，broker 仍完整返回第一个
	// batch（KIP-74），用一次往返换掉这部分浪费。
	kafkaLargeRecordBytes = kafkaFetchMaxBytes / 4
)

// kafkaPartitionFetcher 执行单分区 fetch。生产实现走 kafka.Client，测试用内存日志。
type kafkaPartitionFetcher interface {
	fetchPartition(ctx context.Context, request kafkaPartitionFetch) (kafkaPartitionBatch, error)
}

type kafkaPartitionFetch struct {
	Topic     string
	Partition int
	Offset    int64
	MaxBytes  int64
}

type kafkaPartitionBatch struct {
	HighWatermark int64
	// Records 已过滤控制 batch；可能包含 offset 小于请求值的记录（broker 按 batch 返回）。
	Records kafka.RecordReader
}

// kafkaPartitionWindow 描述一次分区读取：[Start, End) 内最多 Target 条，累计体积受 Budget 约束。
type kafkaPartitionWindow struct {
	Topic        string
	Partition    int
	Start        int64
	End          int64
	Target       int
	Latest       bool
	Budget       int64
	FetchBytes   int64
	IncludeValue bool
}

// kafkaLatestWindowStart 计算「最新 N 条」的起始 offset：不早于分区最早 offset。
func kafkaLatestWindowStart(first, last int64, target int) int64 {
	start := last - int64(target)
	if start < first {
		return first
	}
	return start
}

type kafkaPartitionRead struct {
	fetcher   kafkaPartitionFetcher
	window    kafkaPartitionWindow
	next      int64
	records   []kafkaMessageRecord
	bytes     int64
	truncated bool
	jumped    bool
	stalled   int
	// largeRecords 一旦置位就保持：跳到尾部会清空已读记录，但消息体积不会因此变小。
	largeRecords bool
}

// readKafkaPartition 读取一个分区窗口。
//
// 只读到 window.End（起始时的 high-water mark）为止，不等待新消息：之前用读超时判定
// 「没有更多消息」，大消息在超时内传不完就被当成读完了，表现为随机少几条。
// earliest 从头读到预算用尽；latest 读到尾部后从前面裁剪，保留最新的消息。
func readKafkaPartition(ctx context.Context, fetcher kafkaPartitionFetcher, window kafkaPartitionWindow) ([]kafkaMessageRecord, bool, error) {
	read := &kafkaPartitionRead{fetcher: fetcher, window: window, next: window.Start}
	if err := read.run(ctx); err != nil {
		return nil, false, err
	}
	if window.Latest {
		read.trimToBudgetFromTail()
	} else if read.budgetExhausted() && read.next < window.End && len(read.records) < window.Target {
		read.truncated = true
	}
	return read.records, read.truncated, nil
}

func (r *kafkaPartitionRead) run(ctx context.Context) error {
	for r.next < r.window.End && len(r.records) < r.window.Target {
		if !r.window.Latest && r.budgetExhausted() {
			return nil
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		batch, err := r.fetcher.fetchPartition(ctx, kafkaPartitionFetch{
			Topic:     r.window.Topic,
			Partition: r.window.Partition,
			Offset:    r.next,
			MaxBytes:  r.fetchBytes(),
		})
		if err != nil {
			return err
		}
		progressed, err := r.consume(batch)
		if err != nil {
			return err
		}
		if !progressed {
			if r.stalled++; r.stalled > kafkaMaxStalledFetches {
				logger.Warnf("Kafka 预览在 %s[%d] offset=%d 连续 %d 次没有新记录，停止读取该分区",
					r.window.Topic, r.window.Partition, r.next, r.stalled)
				return nil
			}
			r.next++
			continue
		}
		r.stalled = 0
		if n := int64(len(r.records)); n > 0 && r.bytes/n >= kafkaLargeRecordBytes {
			r.largeRecords = true
		}
		r.maybeJumpToTail()
	}
	return nil
}

// consume 取出本次响应里 [next, End) 内的记录，返回是否有进展。
func (r *kafkaPartitionRead) consume(batch kafkaPartitionBatch) (bool, error) {
	if batch.Records == nil {
		return false, nil
	}
	progressed := false
	for len(r.records) < r.window.Target {
		if !r.window.Latest && r.budgetExhausted() {
			break
		}
		record, err := batch.Records.ReadRecord()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			return progressed, fmt.Errorf("解析 Kafka %s[%d] 消息失败：%w", r.window.Topic, r.window.Partition, err)
		}
		if record.Offset < r.next {
			continue
		}
		if record.Offset >= r.window.End {
			break
		}
		message, err := kafkaRecordToMessage(r.window.Topic, r.window.Partition, batch.HighWatermark, record, r.window.IncludeValue)
		if err != nil {
			return progressed, err
		}
		r.records = append(r.records, message)
		r.bytes += kafkaRecordBytes(message)
		r.next = record.Offset + 1
		progressed = true
	}
	return progressed, nil
}

func (r *kafkaPartitionRead) fetchBytes() int64 {
	limit := r.window.FetchBytes
	if limit <= 0 {
		limit = kafkaFetchMaxBytes
	}
	if r.largeRecords && limit > kafkaDetailFetchMaxBytes {
		limit = kafkaDetailFetchMaxBytes
	}
	if r.window.Budget > 0 && !r.window.Latest {
		if remain := r.window.Budget - r.bytes; remain < limit {
			limit = remain
		}
	}
	if limit < 1 {
		limit = 1
	}
	return limit
}

func (r *kafkaPartitionRead) budgetExhausted() bool {
	return r.window.Budget > 0 && r.bytes >= r.window.Budget
}

// maybeJumpToTail 只用于 latest：按已读消息的平均体积估算预算能装下几条，窗口装不下时
// 直接跳到尾部，避免把整个窗口的大消息传一遍再丢掉。
func (r *kafkaPartitionRead) maybeJumpToTail() {
	if !r.window.Latest || r.window.Budget <= 0 || len(r.records) == 0 {
		return
	}
	remaining := r.window.End - r.next
	if remaining <= 0 {
		return
	}
	average := r.bytes / int64(len(r.records))
	if average <= 0 || r.bytes+remaining*average <= r.window.Budget {
		return
	}
	fit := r.window.Budget / average
	if fit < 1 {
		fit = 1
	}
	jumpTo := r.window.End - fit
	if jumpTo <= r.next {
		return
	}
	r.next = jumpTo
	r.records = nil
	r.bytes = 0
	r.jumped = true
}

// trimToBudgetFromTail 从最新一条往前累计，超出预算的旧消息丢掉；至少保留一条。
func (r *kafkaPartitionRead) trimToBudgetFromTail() {
	if r.jumped {
		r.truncated = true
	}
	if r.window.Budget <= 0 || len(r.records) == 0 {
		return
	}
	var total int64
	keepFrom := 0
	for i := len(r.records) - 1; i >= 0; i-- {
		total += kafkaRecordBytes(r.records[i])
		if total > r.window.Budget && i < len(r.records)-1 {
			keepFrom = i + 1
			break
		}
	}
	if keepFrom > 0 {
		r.records = append([]kafkaMessageRecord(nil), r.records[keepFrom:]...)
		r.truncated = true
	}
}

func kafkaRecordBytes(record kafkaMessageRecord) int64 {
	return int64(record.valueSize() + len(record.Message.Key))
}

// kafkaRecordToMessage 把 fetch 返回的记录转成内部记录。includeValue 为 false 时只记录
// payload 字节数，不拷贝也不解码；key 与 headers 体积小，始终读取。
func kafkaRecordToMessage(topic string, partition int, highWatermark int64, record *kafka.Record, includeValue bool) (kafkaMessageRecord, error) {
	key, err := kafka.ReadAll(record.Key)
	if err != nil {
		return kafkaMessageRecord{}, fmt.Errorf("读取 Kafka 消息 key 失败：%w", err)
	}
	valueSize := 0
	var value []byte
	if record.Value != nil {
		valueSize = record.Value.Len()
		if includeValue {
			if value, err = kafka.ReadAll(record.Value); err != nil {
				return kafkaMessageRecord{}, fmt.Errorf("读取 Kafka 消息 value 失败：%w", err)
			}
		}
	}
	headers := append([]kafka.Header(nil), record.Headers...)
	message := kafka.Message{
		Topic:         topic,
		Partition:     partition,
		Offset:        record.Offset,
		HighWaterMark: highWatermark,
		Key:           key,
		Value:         value,
		Headers:       headers,
		Time:          kafkaRecordTime(record.Time),
	}
	return kafkaMessageRecord{
		Message:   message,
		Key:       kafkaDecodePayload(key),
		Headers:   kafkaHeadersToMap(headers),
		ValueSize: valueSize,
	}, nil
}

// kafkaRecordTime 与旧的 Conn 读取保持一致：UTC，非正时间戳视为未设置。
// protocol 包按本地时区构造时间，且把 0 解析成 1970-01-01。
func kafkaRecordTime(value time.Time) time.Time {
	if value.UnixMilli() <= 0 {
		return time.Time{}
	}
	return value.UTC()
}
