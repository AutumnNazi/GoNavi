package runharness

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"unicode/utf8"
)

const sessionTitleMaxRunes = 80

// sessionTitleFromMessage 用首条用户消息的第一行给新建会话起名。
// 空内容保持空标题，界面再显示「新对话」，不要落一个英文占位。
func sessionTitleFromMessage(message *Message) string {
	if message == nil {
		return ""
	}
	return clipSessionTitle(message.Content)
}

func clipSessionTitle(content string) string {
	line := strings.TrimSpace(strings.SplitN(strings.ReplaceAll(content, "\r\n", "\n"), "\n", 2)[0])
	if line == "" {
		return ""
	}
	if utf8.RuneCountInString(line) <= sessionTitleMaxRunes {
		return line
	}
	runes := []rune(line)
	return string(runes[:sessionTitleMaxRunes])
}

// sessionDisplayTitleTx 优先用已保存的标题。旧会话创建时标题是空的，
// 这时回退到第一条用户消息，历史列表才不会全部显示成「新对话」。
func (l *Ledger) sessionDisplayTitleTx(ctx context.Context, tx *sql.Tx, sessionID string, titleBlob []byte) (string, error) {
	var title string
	if err := l.openJSON("sessions", sessionID, "title", titleBlob, &title); err != nil {
		return "", err
	}
	if strings.TrimSpace(title) != "" {
		return strings.TrimSpace(title), nil
	}
	return l.firstUserMessageTitleTx(ctx, tx, sessionID)
}

func (l *Ledger) firstUserMessageTitleTx(ctx context.Context, tx *sql.Tx, sessionID string) (string, error) {
	var messageID string
	var contentBlob []byte
	err := tx.QueryRowContext(ctx, `SELECT id, content FROM messages WHERE session_id=? AND role=? ORDER BY sequence ASC LIMIT 1`, sessionID, "user").Scan(&messageID, &contentBlob)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	var content string
	if err := l.openJSON("messages", messageID, "content", contentBlob, &content); err != nil {
		return "", err
	}
	return clipSessionTitle(content), nil
}
