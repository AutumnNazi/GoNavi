package app

import (
	"bytes"
	"compress/gzip"
	"encoding/json"

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

// QueryResultQueryID exposes the embedded query ID to transports that only see
// the compact wrapper, such as the web request-trace correlation.
func (c CompactQueryResult) QueryResultQueryID() string {
	return c.QueryID
}
