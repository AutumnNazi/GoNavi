package connection

import "strings"

// NonSQLSourceFamily reports how a saved connection is read when it is not a SQL
// database. An empty result means the SQL tools apply.
func NonSQLSourceFamily(dbType string) string {
	switch strings.ToLower(strings.TrimSpace(dbType)) {
	case "nacos":
		return "nacos"
	case "redis":
		return "redis"
	case "chroma", "qdrant", "milvus", "milvusdb", "milvus-db":
		return "vector"
	case "mqtt", "mqtts", "kafka", "apache-kafka", "apache_kafka", "rocketmq", "rabbitmq", "pulsar":
		return "message"
	default:
		return ""
	}
}
