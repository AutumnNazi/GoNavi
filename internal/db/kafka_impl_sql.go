//go:build gonavi_full_drivers || gonavi_kafka_driver

package db

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"regexp"
	"sort"
	"strconv"
	"strings"

	kafka "github.com/segmentio/kafka-go"
)

type kafkaParsedSQL struct {
	Action  string
	Topic   string
	Limit   int
	Offset  int
	GroupID string
	Count   bool
	Latest  bool
	// Columns 是 SELECT 的列投影；为空表示全列。列表预览只取元数据列，
	// payload 由详情查询按 partition+offset 单独拉取。
	Columns []string
	// Partition/MsgOffset 来自 WHERE partition = ? AND offset = ?，用于精确定位单条消息。
	Partition *int
	MsgOffset *int64
}

var (
	kafkaSQLFromRE   = regexp.MustCompile(`(?i)\bFROM\s+(?:"([^"]+)"|` + "`" + `([^` + "`" + `]+)` + "`" + `|([a-zA-Z0-9_.\-]+))`)
	kafkaSQLLimitRE  = regexp.MustCompile(`(?i)\bLIMIT\s+(\d+)`)
	kafkaSQLOffsetRE = regexp.MustCompile(`(?i)\bOFFSET\s+(\d+)`)
	// 列投影与按 partition/offset 精确定位：列表只取元数据列，详情再按定位拉 payload。
	kafkaSQLSelectColumnsRE  = regexp.MustCompile(`(?is)^\s*SELECT\s+(.+?)\s+FROM\s+`)
	kafkaSQLWherePartitionRE = regexp.MustCompile(`(?i)\bWHERE\b[^;]*?\bpartition\s*=\s*(\d+)`)
	kafkaSQLWhereOffsetRE    = regexp.MustCompile(`(?i)\bWHERE\b[^;]*?\boffset\s*=\s*(\d+)`)
	// LATEST / EARLIEST 写在 topic 之后，覆盖连接上配置的起始位置（与 Pulsar 方言一致）。
	kafkaSQLStartRE      = regexp.MustCompile(`(?i)\b(LATEST|EARLIEST)\b`)
	kafkaShowTopicsRE    = regexp.MustCompile(`(?i)^\s*SHOW\s+TOPICS(?:\s+LIMIT\s+(\d+))?\s*$`)
	kafkaShowGroupsRE    = regexp.MustCompile(`(?i)^\s*SHOW\s+CONSUMER\s+GROUPS\s*;?\s*$`)
	kafkaDescribeGroupRE = regexp.MustCompile(`(?i)^\s*(?:DESCRIBE|SHOW)\s+CONSUMER\s+GROUP\s+(?:"([^"]+)"|` + "`" + `([^` + "`" + `]+)` + "`" + `|([a-zA-Z0-9_.\-]+))\s*$`)
	kafkaDescribeTopicRE = regexp.MustCompile(`(?i)^\s*(?:SHOW|DESCRIBE)\s+TOPIC\s+(?:"([^"]+)"|` + "`" + `([^` + "`" + `]+)` + "`" + `|([a-zA-Z0-9_.\-]+))\s*$`)
	kafkaConsumeTopicRE  = regexp.MustCompile(`(?i)^\s*CONSUME(?:\s+GROUP\s+(?:"([^"]+)"|` + "`" + `([^` + "`" + `]+)` + "`" + `|([a-zA-Z0-9_.\-]+)))?\s+FROM\s+(?:"([^"]+)"|` + "`" + `([^` + "`" + `]+)` + "`" + `|([a-zA-Z0-9_.\-]+))`)
)

func parseKafkaSQL(sqlText string, defaultLatest bool) (kafkaParsedSQL, bool) {
	text := strings.TrimSpace(sqlText)
	if text == "" {
		return kafkaParsedSQL{}, false
	}
	if matches := kafkaShowTopicsRE.FindStringSubmatch(text); len(matches) > 0 {
		parsed := kafkaParsedSQL{Action: "show_topics"}
		if len(matches) > 1 && strings.TrimSpace(matches[1]) != "" {
			parsed.Limit, _ = strconv.Atoi(matches[1])
		}
		return parsed, true
	}
	if kafkaShowGroupsRE.MatchString(text) {
		return kafkaParsedSQL{Action: "show_consumer_groups"}, true
	}
	if matches := kafkaDescribeGroupRE.FindStringSubmatch(text); len(matches) > 0 {
		return kafkaParsedSQL{Action: "describe_consumer_group", GroupID: firstNonEmpty(matches[1], matches[2], matches[3])}, true
	}
	if matches := kafkaDescribeTopicRE.FindStringSubmatch(text); len(matches) > 0 {
		return kafkaParsedSQL{
			Action: "describe_topic",
			Topic:  firstNonEmpty(matches[1], matches[2], matches[3]),
		}, true
	}
	if loc := kafkaConsumeTopicRE.FindStringSubmatchIndex(text); loc != nil {
		matches := kafkaSubmatches(text, loc)
		// LIMIT / OFFSET / LATEST 只在 topic 之后匹配，避免误中 topic 名或列名。
		tail := text[loc[1]:]
		parsed := kafkaParsedSQL{
			Action:  "consume",
			GroupID: firstNonEmpty(matches[1], matches[2], matches[3]),
			Topic:   firstNonEmpty(matches[4], matches[5], matches[6]),
			Limit:   defaultKafkaPreviewLimit,
			Latest:  kafkaStartLatest(tail, defaultLatest),
		}
		applyKafkaLimitOffset(&parsed, tail)
		return parsed, true
	}
	if !strings.HasPrefix(strings.ToLower(text), "select") {
		return kafkaParsedSQL{}, false
	}
	loc := kafkaSQLFromRE.FindStringSubmatchIndex(text)
	if loc == nil {
		return kafkaParsedSQL{}, false
	}
	matches := kafkaSubmatches(text, loc)
	tail := text[loc[1]:]
	parsed := kafkaParsedSQL{
		Action: "select",
		Topic:  firstNonEmpty(matches[1], matches[2], matches[3]),
		Limit:  defaultKafkaPreviewLimit,
		Count:  strings.Contains(strings.ToLower(text[:loc[0]]), "count("),
		Latest: kafkaStartLatest(tail, defaultLatest),
	}
	applyKafkaLimitOffset(&parsed, tail)
	if columnMatch := kafkaSQLSelectColumnsRE.FindStringSubmatch(text); len(columnMatch) > 1 {
		parsed.Columns = parseKafkaColumnList(columnMatch[1])
	}
	if partitionMatch := kafkaSQLWherePartitionRE.FindStringSubmatch(tail); len(partitionMatch) > 1 {
		if partition, err := strconv.Atoi(partitionMatch[1]); err == nil {
			parsed.Partition = &partition
		}
	}
	if whereOffsetMatch := kafkaSQLWhereOffsetRE.FindStringSubmatch(tail); len(whereOffsetMatch) > 1 {
		if messageOffset, err := strconv.ParseInt(whereOffsetMatch[1], 10, 64); err == nil {
			parsed.MsgOffset = &messageOffset
		}
	}
	return parsed, true
}

func kafkaSubmatches(text string, loc []int) []string {
	matches := make([]string, len(loc)/2)
	for i := range matches {
		if start, end := loc[2*i], loc[2*i+1]; start >= 0 {
			matches[i] = text[start:end]
		}
	}
	return matches
}

func kafkaStartLatest(tail string, defaultLatest bool) bool {
	if match := kafkaSQLStartRE.FindStringSubmatch(tail); len(match) > 1 {
		return strings.EqualFold(match[1], "LATEST")
	}
	return defaultLatest
}

func applyKafkaLimitOffset(parsed *kafkaParsedSQL, tail string) {
	if limitMatch := kafkaSQLLimitRE.FindStringSubmatch(tail); len(limitMatch) > 1 {
		parsed.Limit, _ = strconv.Atoi(limitMatch[1])
	}
	if offsetMatch := kafkaSQLOffsetRE.FindStringSubmatch(tail); len(offsetMatch) > 1 {
		parsed.Offset, _ = strconv.Atoi(offsetMatch[1])
	}
}

// parseKafkaColumnList 解析 SELECT 的列投影；出现 `*` 或为空表示全列（返回 nil）。
// 基础列名不区分大小写；value./key./headers. 之后的 JSON 路径保持原样，
// 因为 JSON 字段名区分大小写。
func parseKafkaColumnList(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	parts := strings.Split(trimmed, ",")
	columns := make([]string, 0, len(parts))
	for _, part := range parts {
		name := strings.TrimSpace(strings.Trim(strings.TrimSpace(part), "\"`"))
		if name == "*" {
			return nil
		}
		if name == "" {
			continue
		}
		columns = append(columns, normalizeKafkaColumnName(name))
	}
	if len(columns) == 0 {
		return nil
	}
	return columns
}

func normalizeKafkaColumnName(name string) string {
	base, path, hasPath := strings.Cut(name, ".")
	if !hasPath {
		return strings.ToLower(name)
	}
	return strings.ToLower(base) + "." + path
}

func kafkaConsumerGroupRows(groups []kafkaConsumerGroupInfo) []map[string]interface{} {
	rows := make([]map[string]interface{}, 0, len(groups))
	for _, g := range groups {
		rows = append(rows, map[string]interface{}{
			"group": g.GroupID, "state": g.State, "member": g.MemberID, "client_id": g.ClientID, "client_host": g.ClientHost,
			"topic": g.Topic, "partition": kafkaOptionalInt(g.Partition), "current_offset": kafkaOptionalInt64(g.CurrentOffset), "log_end_offset": kafkaOptionalInt64(g.LogEndOffset), "lag": kafkaOptionalInt64(g.Lag),
		})
	}
	return rows
}

func kafkaOptionalInt(value *int) interface{} {
	if value == nil {
		return nil
	}
	return *value
}

func kafkaOptionalInt64(value *int64) interface{} {
	if value == nil {
		return nil
	}
	return *value
}

func kafkaTopicRows(topics []kafkaTopicInfo) []map[string]interface{} {
	rows := make([]map[string]interface{}, 0, len(topics))
	for _, topic := range topics {
		rows = append(rows, map[string]interface{}{
			"topic":           topic.Name,
			"internal":        topic.Internal,
			"partition_count": len(topic.Partitions),
		})
	}
	return rows
}

func kafkaDescribeRows(description kafkaTopicDescription) []map[string]interface{} {
	rows := make([]map[string]interface{}, 0, len(description.Partitions))
	for _, partition := range description.Partitions {
		rows = append(rows, map[string]interface{}{
			"topic":             description.Name,
			"internal":          description.Internal,
			"partition":         partition.ID,
			"leader":            kafkaBrokerAddress(partition.Leader),
			"replicas":          kafkaBrokerAddressesList(partition.Replicas),
			"isr":               kafkaBrokerAddressesList(partition.Isr),
			"offline_replicas":  kafkaBrokerAddressesList(partition.OfflineReplicas),
			"earliest_offset":   partition.EarliestOffset,
			"latest_offset":     partition.LatestOffset,
			"approximate_count": partition.ApproximateCount,
		})
	}
	return rows
}

func kafkaHeadersToMap(headers []kafka.Header) map[string]interface{} {
	result := make(map[string]interface{}, len(headers))
	for _, header := range headers {
		key := strings.TrimSpace(header.Key)
		if key == "" {
			continue
		}
		value := kafkaDecodePayload(header.Value)
		if existing, ok := result[key]; ok {
			switch typed := existing.(type) {
			case []interface{}:
				result[key] = append(typed, value)
			default:
				result[key] = []interface{}{typed, value}
			}
			continue
		}
		result[key] = value
	}
	return result
}

func kafkaDecodePayload(payload []byte) interface{} {
	if payload == nil {
		return nil
	}
	var decoded interface{}
	if err := decodeJSONWithUseNumber(payload, &decoded); err == nil {
		return decoded
	}
	return bytesToDisplayValue(payload, "")
}

func kafkaMessageBytes(value interface{}) ([]byte, error) {
	switch typed := value.(type) {
	case nil:
		return nil, nil
	case []byte:
		return typed, nil
	case string:
		return []byte(typed), nil
	case json.Number:
		return []byte(typed.String()), nil
	case bool, int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64, float32, float64:
		return []byte(fmt.Sprintf("%v", typed)), nil
	case map[string]interface{}, []interface{}:
		return json.Marshal(typed)
	default:
		return json.Marshal(typed)
	}
}

func kafkaMessageHeaders(values map[string]interface{}) ([]kafka.Header, error) {
	if len(values) == 0 {
		return nil, nil
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	headers := make([]kafka.Header, 0, len(keys))
	for _, key := range keys {
		payload, err := kafkaMessageBytes(values[key])
		if err != nil {
			return nil, err
		}
		headers = append(headers, kafka.Header{Key: key, Value: payload})
	}
	return headers, nil
}

func sortKafkaRecords(records []kafkaMessageRecord, latest bool) {
	sort.Slice(records, func(i, j int) bool {
		left := records[i].Message
		right := records[j].Message
		if !left.Time.Equal(right.Time) {
			if latest {
				return left.Time.After(right.Time)
			}
			return left.Time.Before(right.Time)
		}
		if left.Partition != right.Partition {
			if latest {
				return left.Partition > right.Partition
			}
			return left.Partition < right.Partition
		}
		if latest {
			return left.Offset > right.Offset
		}
		return left.Offset < right.Offset
	})
}

func kafkaOffsetMode(latest bool) int64 {
	if latest {
		return kafka.LastOffset
	}
	return kafka.FirstOffset
}

func kafkaTopicMessageCount(description kafkaTopicDescription) int64 {
	var total int64
	for _, partition := range description.Partitions {
		total += partition.ApproximateCount
	}
	return total
}

func kafkaBrokerAddress(broker kafka.Broker) string {
	if strings.TrimSpace(broker.Host) == "" || broker.Port <= 0 {
		return strconv.Itoa(broker.ID)
	}
	return kafkaFormatHostPort(broker.Host, broker.Port)
}

func kafkaBrokerAddressesList(brokers []kafka.Broker) []string {
	result := make([]string, 0, len(brokers))
	for _, broker := range brokers {
		result = append(result, kafkaBrokerAddress(broker))
	}
	return result
}

func kafkaFormatHostPort(host string, port int) string {
	h := strings.TrimSpace(host)
	if strings.Contains(h, ":") && !strings.HasPrefix(h, "[") {
		return fmt.Sprintf("[%s]:%d", h, port)
	}
	return fmt.Sprintf("%s:%d", h, port)
}

func isKafkaReadTimeout(err error) bool {
	if err == nil {
		return false
	}
	if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "i/o timeout")
}

func errorsIsContextTimeout(err error) bool {
	return errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled)
}
