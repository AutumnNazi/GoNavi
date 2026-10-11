package app

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"time"

	"GoNavi-Wails/internal/connection"
)

const (
	compactQueryResultCompressionThreshold = 256 * 1024
	compactQueryResultEncoding             = "gzip-base64-json"
)

type compactResultSetData struct {
	Columns        []string        `json:"columns"`
	RowValues      [][]interface{} `json:"rowValues"`
	Messages       []string        `json:"messages,omitempty"`
	StatementIndex int             `json:"statementIndex,omitempty"`
	Truncated      bool            `json:"truncated,omitempty"`
}

// CompactQueryResult carries a QueryResult while allowing large result-set
// data to cross the Wails bridge as one compressed payload.
type CompactQueryResult struct {
	connection.QueryResult
	DataEncoding string `json:"dataEncoding,omitempty"`
	EncodedData  []byte `json:"encodedData,omitempty"`
}

func compactQueryResult(result connection.QueryResult) connection.QueryResult {
	resultSets, ok := result.Data.([]connection.ResultSetData)
	if !ok {
		return result
	}

	compact := make([]compactResultSetData, 0, len(resultSets))
	for _, resultSet := range resultSets {
		columns := resultSet.Columns
		if len(columns) == 0 && len(resultSet.Rows) > 0 {
			return result
		}
		rowValues := make([][]interface{}, len(resultSet.Rows))
		for rowIndex, row := range resultSet.Rows {
			values := make([]interface{}, len(columns))
			for columnIndex, column := range columns {
				values[columnIndex] = row[column]
			}
			rowValues[rowIndex] = values
		}
		compact = append(compact, compactResultSetData{
			Columns:        columns,
			RowValues:      rowValues,
			Messages:       resultSet.Messages,
			StatementIndex: resultSet.StatementIndex,
			Truncated:      resultSet.Truncated,
		})
	}
	result.Data = compact
	return result
}

func encodeCompactQueryResult(result connection.QueryResult) CompactQueryResult {
	result = compactQueryResult(result)
	resultSets, ok := result.Data.([]compactResultSetData)
	if !ok {
		return CompactQueryResult{QueryResult: result}
	}

	// 链路分解（E）：压缩通道下真正过桥的载荷与 profileQueryResultEncode 量到的
	// 「未压缩结构」不是一回事 —— 后者是行键展开后的全量 JSON，前者是大致 1/3 体积的
	// gzip 字节加 base64。差一个数量级，前端拿未压缩值去减总耗时会让「其余」一段变成负数。
	// 所以在成功压缩的返回点用真实成本覆盖一次；走下面几个兜底分支时数据未压缩，
	// 保留 profileQueryResultEncode 的测量值即可。
	compactionStartedAt := time.Now()

	encoded, err := json.Marshal(resultSets)
	if err != nil || len(encoded) < compactQueryResultCompressionThreshold {
		return CompactQueryResult{QueryResult: result}
	}

	var compressed bytes.Buffer
	writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
	if err != nil {
		return CompactQueryResult{QueryResult: result}
	}
	if _, err = writer.Write(encoded); err != nil {
		_ = writer.Close()
		return CompactQueryResult{QueryResult: result}
	}
	if err = writer.Close(); err != nil || compressed.Len()*4 >= len(encoded)*3 {
		return CompactQueryResult{QueryResult: result}
	}

	result.Data = nil
	result.EncodeMs = time.Since(compactionStartedAt).Microseconds()
	return CompactQueryResult{
		QueryResult:  result,
		DataEncoding: compactQueryResultEncoding,
		EncodedData:  compressed.Bytes(),
	}
}

// DBQueryMultiCompact executes a query-editor batch and removes repeated row
// keys from the Wails payload. Other callers keep the DBQueryMulti contract.
func (a *App) DBQueryMultiCompact(
	config connection.ConnectionConfig,
	dbName string,
	query string,
	queryID string,
) CompactQueryResult {
	return encodeCompactQueryResult(a.DBQueryMulti(config, dbName, query, queryID))
}

// DBQueryMultiWithOptionsCompact 是 DBQueryMultiWithOptions 的压缩传输变体。
//
// 「不限」放开行数预算后，结果集可以远超未压缩通道能承受的规模：未压缩路径会把
// 整份 JSON 内联成一条 JS 字面量交给前端一次性 JSON.parse。这里复用
// DBQueryMultiCompact 的编码（列名只传一次 + gzip + base64），并原样保留行预算
// 语义——预算仍由 normalizeQueryResultBudgetOptions 决定，压缩只改变传输形态。
func (a *App) DBQueryMultiWithOptionsCompact(
	config connection.ConnectionConfig,
	dbName string,
	query string,
	queryID string,
	options QueryResultBudgetOptions,
) CompactQueryResult {
	return encodeCompactQueryResult(a.DBQueryMultiWithOptions(config, dbName, query, queryID, options))
}

// QueryResultQueryID exposes the embedded query ID to transports that only see
// the compact wrapper, such as the web request-trace correlation.
func (c CompactQueryResult) QueryResultQueryID() string {
	return c.QueryID
}
