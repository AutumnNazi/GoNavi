package app

import (
	"context"
	"encoding/json"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/nacos"
	"GoNavi-Wails/internal/redis"
)

const (
	inspectKindNamespaces = "list_namespaces"
	inspectKindGroups     = "list_groups"
	inspectKindEntries    = "list_entries"
	inspectKindEntry      = "get_entry"
	inspectListLimit      = 50
	inspectTextLimit      = 4000
)

// SourceInspectQuery is a read-only look at a Nacos, Redis, vector, or message connection.
type SourceInspectQuery struct {
	Kind      string `json:"kind"`
	Namespace string `json:"namespace,omitempty"`
	Group     string `json:"group,omitempty"`
	Name      string `json:"name,omitempty"`
	Pattern   string `json:"pattern,omitempty"`
}

// InspectSource lists or reads one saved non-SQL connection. SQL connections are refused
// so the caller keeps using the SQL tools.
func (a *App) InspectSource(ctx context.Context, config connection.ConnectionConfig, query SourceInspectQuery) connection.QueryResult {
	if a == nil {
		return connection.QueryResult{Success: false, Message: "应用未就绪"}
	}
	if ctx == nil {
		return connection.QueryResult{Success: false, Message: "缺少请求上下文"}
	}
	if err := ctx.Err(); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}
	family := connection.NonSQLSourceFamily(config.Type)
	if family == "" {
		return connection.QueryResult{Success: false, Message: "该连接是 SQL 数据源，请使用 get_tables 或 execute_sql"}
	}
	query = normalizeSourceInspectQuery(family, query)
	switch family {
	case "nacos":
		return a.inspectNacosSource(config, query)
	case "redis":
		return a.inspectRedisSource(config, query)
	default:
		return a.inspectCatalogSource(ctx, config, family, query)
	}
}

func normalizeSourceInspectQuery(family string, query SourceInspectQuery) SourceInspectQuery {
	query.Kind = strings.ToLower(strings.TrimSpace(query.Kind))
	query.Namespace = strings.TrimSpace(query.Namespace)
	query.Group = strings.TrimSpace(query.Group)
	query.Name = strings.TrimSpace(query.Name)
	query.Pattern = strings.TrimSpace(query.Pattern)
	if query.Kind == "" {
		if family == "message" {
			query.Kind = inspectKindEntries
		} else {
			query.Kind = inspectKindNamespaces
		}
	}
	if query.Pattern == "" {
		query.Pattern = "*"
	}
	return query
}

func (a *App) inspectNacosSource(config connection.ConnectionConfig, query SourceInspectQuery) connection.QueryResult {
	switch query.Kind {
	case inspectKindNamespaces:
		return a.NacosListNamespaces(config)
	case inspectKindGroups:
		return a.NacosListConfigGroups(config, query.Namespace)
	case inspectKindEntries:
		result := a.NacosSearchConfigs(config, NacosConfigQuery{
			NamespaceID: query.Namespace,
			Group:       query.Group,
			DataID:      query.Name,
			PageNo:      1,
			PageSize:    20,
			Search:      "blur",
		})
		if page, ok := result.Data.(*nacos.ConfigPage); ok && page != nil {
			for i := range page.PageItems {
				page.PageItems[i].Content = ""
			}
		}
		return result
	case inspectKindEntry:
		if query.Name == "" || query.Group == "" {
			return connection.QueryResult{Success: false, Message: "读取 Nacos 配置需要 group 和 name（dataId）"}
		}
		result := a.NacosGetConfig(config, query.Namespace, query.Group, query.Name)
		if detail, ok := result.Data.(*nacos.ConfigDetail); ok && detail != nil {
			detail.Content = clipInspectText(detail.Content)
		}
		return result
	default:
		return connection.QueryResult{Success: false, Message: "Nacos 只支持 list_namespaces、list_groups、list_entries、get_entry"}
	}
}

func (a *App) inspectRedisSource(config connection.ConnectionConfig, query SourceInspectQuery) connection.QueryResult {
	if query.Namespace != "" {
		config.Database = query.Namespace
	}
	switch query.Kind {
	case inspectKindNamespaces:
		return a.RedisGetDatabases(config)
	case inspectKindEntries:
		return a.RedisScanKeys(config, query.Pattern, 0, inspectListLimit)
	case inspectKindEntry:
		if query.Name == "" {
			return connection.QueryResult{Success: false, Message: "读取 Redis 需要 name（key）"}
		}
		result := a.RedisGetValue(config, query.Name)
		if value, ok := result.Data.(*redis.RedisValue); ok {
			result.Data = clipRedisInspectValue(value)
		}
		return result
	default:
		return connection.QueryResult{Success: false, Message: "Redis 只支持 list_namespaces、list_entries、get_entry"}
	}
}

func (a *App) inspectCatalogSource(ctx context.Context, config connection.ConnectionConfig, family string, query SourceInspectQuery) connection.QueryResult {
	switch query.Kind {
	case inspectKindNamespaces:
		return a.DBGetDatabases(config)
	case inspectKindEntries:
		result := a.DBGetTablesContext(ctx, config, query.Namespace)
		result.Data = capInspectNames(result.Data)
		return result
	default:
		if family == "vector" {
			return connection.QueryResult{Success: false, Message: "向量库请用 list_namespaces 列出库，再用 list_entries 列出集合"}
		}
		return connection.QueryResult{Success: false, Message: "消息连接请用 list_entries 列出主题或队列"}
	}
}

func capInspectNames(data any) any {
	encoded, err := json.Marshal(data)
	if err != nil {
		return data
	}
	var rows []map[string]string
	if json.Unmarshal(encoded, &rows) != nil || len(rows) <= inspectListLimit {
		return data
	}
	return map[string]any{"entries": rows[:inspectListLimit], "total": len(rows), "truncated": true}
}

func clipRedisInspectValue(value *redis.RedisValue) *redis.RedisValue {
	if value == nil {
		return nil
	}
	encoded, err := json.Marshal(value.Value)
	if err != nil || len(encoded) <= inspectTextLimit {
		return value
	}
	copied := *value
	copied.Value = clipInspectText(string(encoded))
	return &copied
}

func clipInspectText(text string) string {
	runes := []rune(text)
	if len(runes) <= inspectTextLimit {
		return text
	}
	return string(runes[:inspectTextLimit]) + "…"
}
