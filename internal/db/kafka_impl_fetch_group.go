//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"errors"

	kafka "github.com/segmentio/kafka-go"
)

// fetchMessagesWithGroup 以 consumer group 身份读取（CONSUME GROUP ...）。
//
// 加入 group 会触发 rebalance，只在用户显式写 GROUP 或连接配置了 groupId 时使用；
// 工作台预览走 fetchMessagesDirect。读到的消息不提交 offset。
func (r *kafkaGoRuntime) fetchMessagesWithGroup(ctx context.Context, request kafkaFetchRequest) (kafkaFetchResult, error) {
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
	var used int64
	skipped := 0
	truncated := false
	for skipped+len(records) < target {
		if request.ByteBudget > 0 && used >= request.ByteBudget {
			truncated = true
			break
		}
		readCtx, cancel := context.WithTimeout(ctx, r.readWait)
		msg, err := reader.FetchMessage(readCtx)
		cancel()
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return kafkaFetchResult{}, ctxErr
			}
			if isKafkaReadTimeout(err) || errors.Is(err, context.DeadlineExceeded) {
				break
			}
			return kafkaFetchResult{}, err
		}
		if skipped < request.Offset {
			skipped++
			continue
		}
		record := kafkaMessageRecord{
			Message:   msg,
			Key:       kafkaDecodePayload(msg.Key),
			Headers:   kafkaHeadersToMap(msg.Headers),
			ValueSize: len(msg.Value),
		}
		if !request.IncludeValue {
			record.Message.Value = nil
		}
		used += kafkaRecordBytes(record)
		records = append(records, record)
	}
	if request.IncludeValue {
		kafkaDecodeRecordValues(records)
	}
	return kafkaFetchResult{Records: records, Truncated: truncated}, nil
}
