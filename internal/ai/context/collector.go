package aicontext

// DatabaseContext 数据库上下文信息，传递给 AI 辅助上下文理解
type DatabaseContext struct {
	DatabaseType string         `json:"databaseType"` // mysql, postgres 等
	DatabaseName string         `json:"databaseName"`
	Version      string         `json:"version,omitempty"`
	Tables       []TableContext `json:"tables"`
}

// TableContext 表的上下文信息
type TableContext struct {
	Name       string                   `json:"name"`
	Comment    string                   `json:"comment,omitempty"`
	Columns    []ColumnInfo             `json:"columns"`
	Indexes    []IndexInfo              `json:"indexes,omitempty"`
	SampleRows []map[string]interface{} `json:"sampleRows,omitempty"`
	RowCount   int64                    `json:"rowCount,omitempty"`
}

// ColumnInfo 列信息
type ColumnInfo struct {
	Name       string `json:"name"`
	Type       string `json:"type"`
	Nullable   bool   `json:"nullable"`
	PrimaryKey bool   `json:"primaryKey"`
	Comment    string `json:"comment,omitempty"`
}

// IndexInfo 索引信息
type IndexInfo struct {
	Name    string   `json:"name"`
	Columns []string `json:"columns"`
	Unique  bool     `json:"unique"`
}

// QueryResultContext 查询结果上下文
type QueryResultContext struct {
	SQL      string                   `json:"sql"`
	Columns  []string                 `json:"columns"`
	Rows     []map[string]interface{} `json:"rows"`
	RowCount int                      `json:"rowCount"`
}
