//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"time"

	"GoNavi-Wails/internal/connection"

	kafka "github.com/segmentio/kafka-go"
)

const (
	defaultKafkaPort         = 9092
	defaultKafkaQueryTimeout = 30 * time.Second
	defaultKafkaPreviewLimit = 100
	kafkaSyntheticDatabase   = "topics"
	// 单次 fetch 的字节上限：消息队列的 value 常有几 MB 到十几 MB，1 MiB 会让每次
	// 只取到一条，拉满一屏要几十个来回。
	kafkaFetchMaxBytes   = 16 << 20
	kafkaDefaultClientID = "GoNavi"
)

type kafkaRuntime interface {
	Close() error
	Ping(ctx context.Context) error
	ListTopics(ctx context.Context, includeInternal bool) ([]kafkaTopicInfo, error)
	DescribeTopic(ctx context.Context, topic string) (kafkaTopicDescription, error)
	FetchMessages(ctx context.Context, request kafkaFetchRequest) (kafkaFetchResult, error)
	// FetchMessageAt 返回 partition 内 offset 恰好等于请求值的消息；不存在时返回 nil。
	FetchMessageAt(ctx context.Context, locator kafkaMessageLocator) (*kafkaMessageRecord, error)
	Publish(ctx context.Context, command kafkaPublishCommand) (int64, error)
	InspectConsumerGroups(ctx context.Context, groupID string) ([]kafkaConsumerGroupInfo, error)
}

type kafkaConsumerGroupInfo struct {
	GroupID       string
	State         string
	MemberID      string
	ClientID      string
	ClientHost    string
	Topic         string
	Partition     *int
	CurrentOffset *int64
	LogEndOffset  *int64
	Lag           *int64
}

type kafkaTopicInfo struct {
	Name       string
	Internal   bool
	Partitions []kafka.Partition
}

type kafkaTopicDescription struct {
	Name       string
	Internal   bool
	Partitions []kafkaTopicPartition
}

type kafkaTopicPartition struct {
	ID               int
	Leader           kafka.Broker
	Replicas         []kafka.Broker
	Isr              []kafka.Broker
	OfflineReplicas  []kafka.Broker
	EarliestOffset   int64
	LatestOffset     int64
	ApproximateCount int64
}

type kafkaFetchRequest struct {
	Topic   string
	Limit   int
	Offset  int
	GroupID string
	Latest  bool
	// Partition 非空时只读这一个分区（WHERE partition = N）。
	Partition *int
	// IncludeValue 为 false 时只保留 value 的字节数，不拷贝也不解码 payload。
	IncludeValue bool
	// ByteBudget 限制本次读取累计的消息体积（key + value）；<= 0 表示不限。
	ByteBudget int64
}

// kafkaFetchResult 是一次预览读取的结果。Truncated 表示因字节预算提前停止，
// 分区里还有满足条件的消息没有返回。
type kafkaFetchResult struct {
	Records   []kafkaMessageRecord
	Truncated bool
}

// kafkaMessageLocator 精确定位一条消息，供详情按需加载使用。
type kafkaMessageLocator struct {
	Topic     string
	Partition int
	Offset    int64
}

type kafkaPublishCommand struct {
	Topic   string
	Key     interface{}
	Value   interface{}
	Headers map[string]interface{}
}

type kafkaMessageRecord struct {
	Message kafka.Message
	Key     interface{}
	// Value 是解码后的 payload；只在需要 value 列时才填充。
	Value   interface{}
	Headers map[string]interface{}
	// ValueSize 是 payload 原始字节数。元数据读取不拷贝 payload，Message.Value 为空，
	// 只能靠它报告 value_size。
	ValueSize int
}

// valueSize 兼容只填了 Message.Value、没填 ValueSize 的记录。
func (r kafkaMessageRecord) valueSize() int {
	if r.ValueSize > 0 {
		return r.ValueSize
	}
	return len(r.Message.Value)
}

type kafkaGoRuntime struct {
	brokers    []string
	bootstrap  string
	dialer     *kafka.Dialer
	transport  *kafka.Transport
	client     *kafka.Client
	timeout    time.Duration
	readWait   time.Duration
	defaultAck kafka.RequiredAcks
}

var newKafkaRuntime = func(config connection.ConnectionConfig) (kafkaRuntime, error) {
	return newKafkaGoRuntime(config)
}
