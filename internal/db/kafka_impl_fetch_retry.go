//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"errors"
	"time"

	kafka "github.com/segmentio/kafka-go"
)

// kafkaLeaderRetryDelay 是分区 leader 变化后重试前的等待：给新 leader 加载分区留一点时间。
const kafkaLeaderRetryDelay = 200 * time.Millisecond

// retryOnKafkaLeaderChange 在 leader 变化类错误时刷新元数据后重试一次。
//
// 预览走 kafka.Client，分区 leader 来自 Transport 缓存的元数据：缓存最多 6 秒才定时刷新，
// 收到 NotLeaderForPartition 也不会主动刷新。broker 重启或分区迁移后，这段时间里的预览
// 会一直打到旧 leader 上失败。refresh 丢弃连接池（连同缓存），下一次请求重新拉取元数据。
func retryOnKafkaLeaderChange[T any](ctx context.Context, refresh func(), read func() (T, error)) (T, error) {
	result, err := read()
	if err == nil || !isKafkaLeaderChange(err) || ctx.Err() != nil {
		return result, err
	}
	refresh()
	timer := time.NewTimer(kafkaLeaderRetryDelay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		var zero T
		return zero, ctx.Err()
	case <-timer.C:
	}
	return read()
}

// isKafkaLeaderChange 识别「元数据过期或 leader 正在切换」的分区级错误。
func isKafkaLeaderChange(err error) bool {
	for _, code := range []kafka.Error{
		kafka.NotLeaderForPartition,
		kafka.LeaderNotAvailable,
		kafka.UnknownTopicOrPartition,
		kafka.ReplicaNotAvailable,
		kafka.FencedLeaderEpoch,
		kafka.UnknownLeaderEpoch,
		kafka.KafkaStorageError,
	} {
		if errors.Is(err, code) {
			return true
		}
	}
	return false
}

// refreshKafkaMetadata 丢弃 Transport 的连接池与元数据缓存；进行中的请求持有连接池引用，不受影响。
func (r *kafkaGoRuntime) refreshKafkaMetadata() {
	if r.transport != nil {
		r.transport.CloseIdleConnections()
	}
}
