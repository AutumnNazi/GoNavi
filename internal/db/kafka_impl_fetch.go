//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"fmt"
	"sort"
	"strings"

	kafka "github.com/segmentio/kafka-go"
)

// FetchMessages 读取预览消息：带 consumer group 走 Reader，否则按分区直读。
func (r *kafkaGoRuntime) FetchMessages(ctx context.Context, request kafkaFetchRequest) (kafkaFetchResult, error) {
	topic := strings.TrimSpace(request.Topic)
	if topic == "" {
		return kafkaFetchResult{}, fmt.Errorf("Kafka topic 不能为空")
	}
	normalized := request
	normalized.Topic = topic
	normalized.Offset = maxInt(request.Offset, 0)
	if normalized.Limit <= 0 {
		normalized.Limit = defaultKafkaPreviewLimit
	}
	if groupID := strings.TrimSpace(request.GroupID); groupID != "" {
		normalized.GroupID = groupID
		return r.fetchMessagesWithGroup(ctx, normalized)
	}
	return retryOnKafkaLeaderChange(ctx, r.refreshKafkaMetadata, func() (kafkaFetchResult, error) {
		return r.fetchMessagesDirect(ctx, normalized)
	})
}

// fetchMessagesDirect 按分区读取 [start, high-water mark) 内的消息再合并排序。
func (r *kafkaGoRuntime) fetchMessagesDirect(ctx context.Context, request kafkaFetchRequest) (kafkaFetchResult, error) {
	partitions, err := r.topicPartitionIDs(ctx, request.Topic, request.Partition)
	if err != nil {
		return kafkaFetchResult{}, err
	}
	ranges, err := r.partitionRanges(ctx, request.Topic, partitions)
	if err != nil {
		return kafkaFetchResult{}, err
	}
	target := request.Limit + request.Offset
	partitionBudget := kafkaPartitionBudget(request.ByteBudget, len(partitions))
	fetcher := kafkaClientFetcher{client: r.client}
	var result kafkaFetchResult
	for _, partition := range partitions {
		bounds := ranges[partition]
		start := bounds.first
		if request.Latest {
			start = kafkaLatestWindowStart(bounds.first, bounds.last, target)
		}
		records, truncated, err := readKafkaPartition(ctx, fetcher, kafkaPartitionWindow{
			Topic:        request.Topic,
			Partition:    partition,
			Start:        start,
			End:          bounds.last,
			Target:       target,
			Latest:       request.Latest,
			Budget:       partitionBudget,
			IncludeValue: request.IncludeValue,
		})
		if err != nil {
			return kafkaFetchResult{}, err
		}
		result.Records = append(result.Records, records...)
		result.Truncated = result.Truncated || truncated
	}
	sortKafkaRecords(result.Records, request.Latest)
	result.Records = kafkaPaginateRecords(result.Records, request.Offset, request.Limit)
	if request.IncludeValue {
		// 带 payload 的结果要装进一个驱动代理帧：按总预算再裁一次，至少保留一条。
		var trimmed bool
		result.Records, trimmed = kafkaTrimRecordsToBudget(result.Records, request.ByteBudget)
		result.Truncated = result.Truncated || trimmed
		kafkaDecodeRecordValues(result.Records)
	}
	return result, nil
}

// FetchMessageAt 精确定位一条消息，供详情按需加载使用。
//
// broker 返回的是包含该 offset 的整个 batch：offset 被压实或属于事务 marker 时，
// 拿到的第一条会是后面的消息。这里只接受 offset 完全相等的记录，否则视为不存在，
// 避免详情面板把另一条消息当成用户点的那条展示。
func (r *kafkaGoRuntime) FetchMessageAt(ctx context.Context, locator kafkaMessageLocator) (*kafkaMessageRecord, error) {
	topic := strings.TrimSpace(locator.Topic)
	if topic == "" {
		return nil, fmt.Errorf("Kafka topic 不能为空")
	}
	if locator.Partition < 0 {
		return nil, fmt.Errorf("Kafka partition 不能为负数：%d", locator.Partition)
	}
	if locator.Offset < 0 {
		return nil, fmt.Errorf("Kafka offset 不能为负数：%d", locator.Offset)
	}
	locator.Topic = topic
	return retryOnKafkaLeaderChange(ctx, r.refreshKafkaMetadata, func() (*kafkaMessageRecord, error) {
		return r.readMessageAt(ctx, locator)
	})
}

func (r *kafkaGoRuntime) readMessageAt(ctx context.Context, locator kafkaMessageLocator) (*kafkaMessageRecord, error) {
	topic := locator.Topic
	ranges, err := r.partitionRanges(ctx, topic, []int{locator.Partition})
	if err != nil {
		return nil, err
	}
	bounds := ranges[locator.Partition]
	if locator.Offset < bounds.first || locator.Offset >= bounds.last {
		return nil, nil
	}
	records, _, err := readKafkaPartition(ctx, kafkaClientFetcher{client: r.client}, kafkaPartitionWindow{
		Topic:        topic,
		Partition:    locator.Partition,
		Start:        locator.Offset,
		End:          locator.Offset + 1,
		Target:       1,
		FetchBytes:   kafkaDetailFetchMaxBytes,
		IncludeValue: true,
	})
	if err != nil {
		return nil, err
	}
	if len(records) == 0 || records[0].Message.Offset != locator.Offset {
		return nil, nil
	}
	kafkaDecodeRecordValues(records)
	return &records[0], nil
}

type kafkaOffsetBounds struct {
	first int64
	last  int64
}

// topicPartitionIDs 返回要读取的分区；指定 partition 时校验它存在。
func (r *kafkaGoRuntime) topicPartitionIDs(ctx context.Context, topic string, only *int) ([]int, error) {
	resp, err := r.client.Metadata(ctx, &kafka.MetadataRequest{Addr: kafka.TCP(r.bootstrap), Topics: []string{topic}})
	if err != nil {
		return nil, err
	}
	for _, info := range resp.Topics {
		if info.Name != topic {
			continue
		}
		if info.Error != nil {
			return nil, info.Error
		}
		ids := make([]int, 0, len(info.Partitions))
		for _, partition := range info.Partitions {
			if only == nil || partition.ID == *only {
				ids = append(ids, partition.ID)
			}
		}
		if only != nil && len(ids) == 0 {
			return nil, fmt.Errorf("Kafka topic %s 不存在分区 %d", topic, *only)
		}
		sort.Ints(ids)
		return ids, nil
	}
	return nil, fmt.Errorf("Kafka topic 不存在：%s", topic)
}

// partitionRanges 一次 ListOffsets 拿到全部分区的最早与 high-water mark。
// 最早、最新分两次请求：同一请求里重复出现同一分区会被新版本 broker 拒绝。
func (r *kafkaGoRuntime) partitionRanges(ctx context.Context, topic string, partitions []int) (map[int]kafkaOffsetBounds, error) {
	first, err := r.listOffsets(ctx, topic, partitions, kafka.FirstOffset)
	if err != nil {
		return nil, err
	}
	last, err := r.listOffsets(ctx, topic, partitions, kafka.LastOffset)
	if err != nil {
		return nil, err
	}
	ranges := make(map[int]kafkaOffsetBounds, len(partitions))
	for _, partition := range partitions {
		ranges[partition] = kafkaOffsetBounds{first: first[partition], last: last[partition]}
	}
	return ranges, nil
}

func (r *kafkaGoRuntime) listOffsets(ctx context.Context, topic string, partitions []int, timestamp int64) (map[int]int64, error) {
	requests := make([]kafka.OffsetRequest, 0, len(partitions))
	for _, partition := range partitions {
		requests = append(requests, kafka.OffsetRequest{Partition: partition, Timestamp: timestamp})
	}
	resp, err := r.client.ListOffsets(ctx, &kafka.ListOffsetsRequest{
		Addr:   kafka.TCP(r.bootstrap),
		Topics: map[string][]kafka.OffsetRequest{topic: requests},
	})
	if err != nil {
		return nil, err
	}
	offsets := make(map[int]int64, len(partitions))
	for _, partition := range resp.Topics[topic] {
		if partition.Error != nil {
			return nil, fmt.Errorf("读取 Kafka %s[%d] offset 失败：%w", topic, partition.Partition, partition.Error)
		}
		if timestamp == kafka.FirstOffset {
			offsets[partition.Partition] = partition.FirstOffset
		} else {
			offsets[partition.Partition] = partition.LastOffset
		}
	}
	for _, partition := range partitions {
		if _, ok := offsets[partition]; !ok {
			return nil, fmt.Errorf("Kafka %s[%d] 没有返回 offset", topic, partition)
		}
	}
	return offsets, nil
}

// partitionOffsets 读取单个分区的最早与最新 offset（DescribeTopic / 消费组诊断使用）。
func (r *kafkaGoRuntime) partitionOffsets(ctx context.Context, topic string, partitionID int) (int64, int64, error) {
	conn, err := r.dialer.DialLeader(ctx, "tcp", r.bootstrap, topic, partitionID)
	if err != nil {
		return 0, 0, err
	}
	defer conn.Close()
	return conn.ReadOffsets()
}

// kafkaClientFetcher 用 kafka.Client.Fetch 执行单分区读取：连接池复用、ctx 可取消、
// 控制 batch（事务 marker）由 kafka-go 过滤。
type kafkaClientFetcher struct {
	client *kafka.Client
}

func (f kafkaClientFetcher) fetchPartition(ctx context.Context, request kafkaPartitionFetch) (kafkaPartitionBatch, error) {
	fetchCtx, cancel := context.WithTimeout(ctx, kafkaFetchMaxWait+kafkaFetchTransferBudget)
	defer cancel()
	resp, err := f.client.Fetch(fetchCtx, &kafka.FetchRequest{
		Topic:     request.Topic,
		Partition: request.Partition,
		Offset:    request.Offset,
		MinBytes:  1,
		MaxBytes:  request.MaxBytes,
		MaxWait:   kafkaFetchMaxWait,
	})
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return kafkaPartitionBatch{}, ctxErr
		}
		return kafkaPartitionBatch{}, err
	}
	if resp.Error != nil {
		return kafkaPartitionBatch{}, fmt.Errorf("读取 Kafka %s[%d] offset=%d 失败：%w", request.Topic, request.Partition, request.Offset, resp.Error)
	}
	return kafkaPartitionBatch{HighWatermark: resp.HighWatermark, Records: resp.Records}, nil
}

// kafkaPartitionBudget 把总预算平摊到分区，每个分区至少 1 MiB，避免小 topic 被切得太碎。
func kafkaPartitionBudget(total int64, partitions int) int64 {
	if total <= 0 || partitions <= 1 {
		return total
	}
	share := total / int64(partitions)
	if share < 1<<20 {
		share = 1 << 20
	}
	return share
}

func kafkaPaginateRecords(records []kafkaMessageRecord, offset, limit int) []kafkaMessageRecord {
	if offset >= len(records) {
		return []kafkaMessageRecord{}
	}
	records = records[offset:]
	if limit > 0 && len(records) > limit {
		records = records[:limit]
	}
	return records
}

// kafkaTrimRecordsToBudget 保留累计体积不超过预算的前缀，至少一条。
func kafkaTrimRecordsToBudget(records []kafkaMessageRecord, budget int64) ([]kafkaMessageRecord, bool) {
	if budget <= 0 || len(records) <= 1 {
		return records, false
	}
	var total int64
	for i, record := range records {
		total += kafkaRecordBytes(record)
		if total > budget && i > 0 {
			return records[:i], true
		}
	}
	return records, false
}

// kafkaDecodeRecordValues 只解码最终返回的记录：JSON 解码比传输更费 CPU 和内存。
func kafkaDecodeRecordValues(records []kafkaMessageRecord) {
	for i := range records {
		if records[i].Message.Value != nil {
			records[i].Value = kafkaDecodePayload(records[i].Message.Value)
		}
	}
}
