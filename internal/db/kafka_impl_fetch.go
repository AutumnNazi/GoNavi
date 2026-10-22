//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"time"

	kafka "github.com/segmentio/kafka-go"
)

func (r *kafkaGoRuntime) fetchMessagesWithGroup(ctx context.Context, request kafkaFetchRequest) ([]kafkaMessageRecord, error) {
	reader := kafka.NewReader(kafka.ReaderConfig{
		Brokers:         append([]string(nil), r.brokers...),
		GroupID:         request.GroupID,
		Topic:           request.Topic,
		Dialer:          r.dialer,
		QueueCapacity:   maxInt(request.Limit+request.Offset, 1),
		MinBytes:        1,
		MaxBytes:        kafkaFetchMaxBytes,
		MaxWait:         r.readWait,
		ReadLagInterval: -1,
		CommitInterval:  0,
		StartOffset:     kafkaOffsetMode(request.Latest),
		MaxAttempts:     1,
	})
	defer reader.Close()

	target := request.Limit + request.Offset
	records := make([]kafkaMessageRecord, 0, request.Limit)
	skipped := 0
	for len(records) < request.Limit && skipped+len(records) < target {
		readCtx, cancel := context.WithTimeout(ctx, r.readWait)
		msg, err := reader.FetchMessage(readCtx)
		cancel()
		if err != nil {
			if isKafkaReadTimeout(err) || errorsIsContextTimeout(err) {
				break
			}
			return nil, err
		}
		record := kafkaMessageRecord{
			Message: msg,
			Key:     kafkaDecodePayload(msg.Key),
			Value:   kafkaDecodePayload(msg.Value),
			Headers: kafkaHeadersToMap(msg.Headers),
		}
		if skipped < request.Offset {
			skipped++
			continue
		}
		records = append(records, record)
	}
	return records, nil
}

func (r *kafkaGoRuntime) fetchMessagesDirect(ctx context.Context, request kafkaFetchRequest) ([]kafkaMessageRecord, error) {
	partitions, err := r.dialer.LookupPartitions(ctx, "tcp", r.bootstrap, request.Topic)
	if err != nil {
		return nil, err
	}
	sort.Slice(partitions, func(i, j int) bool {
		return partitions[i].ID < partitions[j].ID
	})
	target := maxInt(request.Limit+request.Offset, request.Limit)
	records := make([]kafkaMessageRecord, 0, target)
	for _, partition := range partitions {
		start, err := r.partitionStartOffset(ctx, request.Topic, partition.ID, request.Latest, target)
		if err != nil {
			return nil, err
		}
		items, err := r.fetchPartitionMessages(ctx, request.Topic, partition.ID, start, target)
		if err != nil {
			return nil, err
		}
		records = append(records, items...)
	}
	sortKafkaRecords(records, request.Latest)
	if request.Offset >= len(records) {
		return []kafkaMessageRecord{}, nil
	}
	records = records[request.Offset:]
	if len(records) > request.Limit {
		records = records[:request.Limit]
	}
	return records, nil
}

func (r *kafkaGoRuntime) partitionStartOffset(ctx context.Context, topic string, partitionID int, latest bool, limit int) (int64, error) {
	first, last, err := r.partitionOffsets(ctx, topic, partitionID)
	if err != nil {
		return 0, err
	}
	if !latest {
		return first, nil
	}
	start := last - int64(limit)
	if start < first {
		start = first
	}
	return start, nil
}

func (r *kafkaGoRuntime) partitionOffsets(ctx context.Context, topic string, partitionID int) (int64, int64, error) {
	conn, err := r.dialer.DialLeader(ctx, "tcp", r.bootstrap, topic, partitionID)
	if err != nil {
		return 0, 0, err
	}
	defer conn.Close()
	return conn.ReadOffsets()
}

type kafkaOffsetSeeker interface {
	Seek(offset int64, whence int) (int64, error)
}

func seekKafkaAbsoluteOffset(conn kafkaOffsetSeeker, offset int64) error {
	_, err := conn.Seek(offset, kafka.SeekAbsolute)
	return err
}

// FetchMessageAt 按 partition + offset 精确定位一条消息，供详情按需加载使用。
// 列表预览只取元数据列，payload 在这里单独读取，避免列表帧被大消息撑爆。
func (r *kafkaGoRuntime) FetchMessageAt(ctx context.Context, topic string, partition int, offset int64) (*kafkaMessageRecord, error) {
	trimmedTopic := strings.TrimSpace(topic)
	if trimmedTopic == "" {
		return nil, fmt.Errorf("Kafka topic 不能为空")
	}
	if partition < 0 {
		return nil, fmt.Errorf("Kafka partition 不能为负数：%d", partition)
	}
	if offset < 0 {
		return nil, fmt.Errorf("Kafka offset 不能为负数：%d", offset)
	}
	records, err := r.fetchPartitionMessages(ctx, trimmedTopic, partition, offset, 1)
	if err != nil {
		return nil, err
	}
	if len(records) == 0 {
		return nil, nil
	}
	record := records[0]
	return &record, nil
}

func (r *kafkaGoRuntime) fetchPartitionMessages(ctx context.Context, topic string, partitionID int, startOffset int64, limit int) ([]kafkaMessageRecord, error) {
	conn, err := r.dialer.DialLeader(ctx, "tcp", r.bootstrap, topic, partitionID)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	if err := seekKafkaAbsoluteOffset(conn, startOffset); err != nil {
		return nil, err
	}
	// readWait 衡量的是「空闲多久算没有更多消息」，而不是整个拉取的硬超时：
	// 之前只在循环外设一次 deadline，十几 MB 的消息读两三条就会撞上 1.5 秒上限，
	// 表现为「topic 明明有很多消息却只列出几条」。ctx 的截止时间仍作为硬上限。
	nextReadDeadline := func() time.Time {
		deadline := time.Now().Add(r.readWait)
		if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
			return ctxDeadline
		}
		return deadline
	}

	records := make([]kafkaMessageRecord, 0, limit)
	for len(records) < limit {
		_ = conn.SetReadDeadline(nextReadDeadline())
		// 必须按批读取：conn.ReadMessage 内部是「ReadBatch(1, maxBytes) → 只取第一条 →
		// Close 丢弃批内其余消息」，等于一条一个网络来回，还把同批消息白白扔掉。
		// 这里一次 fetch 拿一批，把批内消息全部消费掉，只受单次 fetch 字节上限约束。
		batch := conn.ReadBatch(1, kafkaFetchMaxBytes)
		for len(records) < limit {
			msg, err := batch.ReadMessage()
			if err != nil {
				// 批内读完（io.EOF）或读超时：交给 Close 判定是否整体结束。
				break
			}
			records = append(records, kafkaMessageRecord{
				Message: msg,
				Key:     kafkaDecodePayload(msg.Key),
				Value:   kafkaDecodePayload(msg.Value),
				Headers: kafkaHeadersToMap(msg.Headers),
			})
		}
		closeErr := batch.Close()
		if closeErr == nil {
			continue
		}
		if isKafkaReadTimeout(closeErr) || errorsIsContextTimeout(closeErr) || errors.Is(closeErr, io.EOF) {
			break
		}
		return nil, closeErr
	}
	return records, nil
}
