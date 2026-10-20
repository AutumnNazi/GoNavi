//go:build gonavi_full_drivers || gonavi_kingbase_driver

package db

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// gokb 的 simple query 读到第一条语句的完成包就返回，后面语句的回包留在连接上。
// database/sql 随即把这条连接放回池；下一次拿到它时，残留回包会被当成新错误。
// 多条语句因此必须钉在同一条连接上，包进事务逐条执行，读完回包再归还连接。
func (k *KingbaseDB) ExecContext(ctx context.Context, query string) (int64, error) {
	return k.execContext(ctx, query)
}

func (k *KingbaseDB) ExecBatchContext(ctx context.Context, query string) (int64, error) {
	return k.execContext(ctx, query)
}

func (k *KingbaseDB) Exec(query string) (int64, error) {
	return k.execContext(context.Background(), query)
}

func (k *KingbaseDB) execContext(ctx context.Context, query string) (int64, error) {
	if k.conn == nil {
		return 0, fmt.Errorf("连接未打开")
	}
	statements := splitKingbaseSimpleQueryStatements(query)
	if len(statements) <= 1 {
		return execKingbaseContext(ctx, k.conn, query)
	}
	return execKingbaseStatementsInTransaction(ctx, k.conn, statements)
}

func execKingbaseStatementsInTransaction(ctx context.Context, dbConn *sql.DB, statements []string) (int64, error) {
	tx, err := dbConn.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()

	var affected int64
	for _, statement := range statements {
		rows, err := execKingbaseContext(ctx, tx, statement)
		if err != nil {
			return 0, err
		}
		affected += rows
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	committed = true
	return affected, nil
}

func execKingbaseContext(ctx context.Context, execer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, query string) (int64, error) {
	res, err := execer.ExecContext(ctx, query)
	if err != nil {
		return 0, err
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, nil
	}
	return affected, nil
}

// splitKingbaseSimpleQueryStatements 只识别 simple query 会真正拆开的语句边界。
// 字符串、美元引用、注释和标识符里的分号仍属于同一条语句。
func splitKingbaseSimpleQueryStatements(query string) []string {
	var statements []string
	var current strings.Builder
	inSingle := false
	inDouble := false
	inLineComment := false
	inBlockComment := false
	dollarTag := ""

	push := func() {
		statement := strings.TrimSpace(current.String())
		current.Reset()
		if statement != "" {
			statements = append(statements, statement)
		}
	}

	for i := 0; i < len(query); i++ {
		ch := query[i]
		next := byte(0)
		if i+1 < len(query) {
			next = query[i+1]
		}

		if inLineComment {
			current.WriteByte(ch)
			if ch == '\n' {
				inLineComment = false
			}
			continue
		}
		if inBlockComment {
			current.WriteByte(ch)
			if ch == '*' && next == '/' {
				current.WriteByte(next)
				i++
				inBlockComment = false
			}
			continue
		}
		if dollarTag != "" {
			if strings.HasPrefix(query[i:], dollarTag) {
				current.WriteString(dollarTag)
				i += len(dollarTag) - 1
				dollarTag = ""
				continue
			}
			current.WriteByte(ch)
			continue
		}
		if inSingle {
			current.WriteByte(ch)
			if ch == '\'' && next == '\'' {
				current.WriteByte(next)
				i++
				continue
			}
			if ch == '\'' {
				inSingle = false
			}
			continue
		}
		if inDouble {
			current.WriteByte(ch)
			if ch == '"' && next == '"' {
				current.WriteByte(next)
				i++
				continue
			}
			if ch == '"' {
				inDouble = false
			}
			continue
		}

		if ch == '-' && next == '-' {
			current.WriteByte(ch)
			current.WriteByte(next)
			i++
			inLineComment = true
			continue
		}
		if ch == '/' && next == '*' {
			current.WriteByte(ch)
			current.WriteByte(next)
			i++
			inBlockComment = true
			continue
		}
		if ch == '$' {
			if tag := kingbaseDollarTagAt(query, i); tag != "" {
				current.WriteString(tag)
				i += len(tag) - 1
				dollarTag = tag
				continue
			}
		}
		if ch == '\'' {
			current.WriteByte(ch)
			inSingle = true
			continue
		}
		if ch == '"' {
			current.WriteByte(ch)
			inDouble = true
			continue
		}
		if ch == ';' {
			push()
			continue
		}
		current.WriteByte(ch)
	}
	push()
	return statements
}

func kingbaseDollarTagAt(query string, start int) string {
	if start >= len(query) || query[start] != '$' {
		return ""
	}
	for i := start + 1; i < len(query); i++ {
		ch := query[i]
		if ch == '$' {
			return query[start : i+1]
		}
		if !isKingbaseDollarTagByte(ch) {
			return ""
		}
	}
	return ""
}

func isKingbaseDollarTagByte(ch byte) bool {
	return ch == '_' ||
		(ch >= '0' && ch <= '9') ||
		(ch >= 'A' && ch <= 'Z') ||
		(ch >= 'a' && ch <= 'z')
}
