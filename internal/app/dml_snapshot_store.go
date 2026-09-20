package app

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
)

// 执行前数据快照存储（P1：DataGrid 行编辑提交）。
//
// 设计要点（照 query_history_store.go 的既有模式，不引入 SQLite）：
//   - 目录：<configDir>/dml_snapshots/，随数据根迁移自动跟随
//   - 单文件 JSONL 追加写，5MB 滚动为 .1
//   - 进程内 mutex + 跨进程文件锁；目录 0700 / 文件 0600
//   - 条数 + 天数双维度裁剪
//   - 只保存**无法从数据库反推**的执行前值；正向 SQL 可随时由 ChangeSet 重算，不冗余存储
//
// 诚实性约束：快照只是"还原线索"，不是回滚保证。生成过反向语句不等于能完整回滚 ——
// 并发覆盖、约束冲突、触发器副作用、超期裁剪都会让它失效，UI 必须如实声明。

const (
	dmlSnapshotDirName      = "dml_snapshots"
	dmlSnapshotFileMaxBytes = 5 * 1024 * 1024
	dmlSnapshotMaxEntries   = 500
	dmlSnapshotRetentionDays = 30
	dmlSnapshotFileName     = "snapshots.jsonl"
	// 单个快照序列化后的上限，避免超大结果集把单个条目撑到不可读。
	dmlSnapshotMaxRecordBytes = 8 * 1024 * 1024
)

// dmlSnapshotEntry 一条执行前快照。
type dmlSnapshotEntry struct {
	ID         string                  `json:"id"`
	CreatedAt  string                  `json:"createdAt"`
	Connection string                  `json:"connection,omitempty"`
	Driver     string                  `json:"driver,omitempty"`
	DBName     string                  `json:"dbName,omitempty"`
	Table      string                  `json:"table"`
	Changes    connection.ChangeSet    `json:"changes"`
	Reverse    db.ChangeReverseResult  `json:"reverse"`
}

type dmlSnapshotStore struct {
	mu       *sync.Mutex
	filePath string
}

var dmlSnapshotStoreLocks sync.Map

func newDMLSnapshotStore(configDir string) *dmlSnapshotStore {
	if strings.TrimSpace(configDir) == "" {
		configDir = resolveAppConfigDir()
	}
	filePath := filepath.Clean(filepath.Join(configDir, dmlSnapshotDirName, dmlSnapshotFileName))
	lock, _ := dmlSnapshotStoreLocks.LoadOrStore(filePath, &sync.Mutex{})
	return &dmlSnapshotStore{mu: lock.(*sync.Mutex), filePath: filePath}
}

// Append 追加一条快照并在超限时裁剪。失败只记日志，绝不影响已提交的数据变更。
//
// 返回值仅在诊断场景有意义：调用方（ApplyChanges）必须保证写入失败不会让一次
// 成功的提交变成失败 —— 那会让用户误以为数据没落地而重试，造成二次写入。
func (s *dmlSnapshotStore) Append(entry dmlSnapshotEntry) error {
	if s == nil {
		return nil
	}
	payload, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	if len(payload) > dmlSnapshotMaxRecordBytes {
		return fmt.Errorf("dml snapshot too large: %d bytes", len(payload))
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	if err := os.MkdirAll(filepath.Dir(s.filePath), 0o700); err != nil {
		return err
	}
	fileLock, err := acquireQueryHistoryFileLock(s.filePath + ".lock")
	if err != nil {
		return err
	}
	defer func() {
		if releaseErr := fileLock.Close(); releaseErr != nil {
			logger.Warnf("释放数据快照文件锁失败：%v path=%s", releaseErr, s.filePath)
		}
	}()

	if err := s.rotateLocked(); err != nil {
		logger.Warnf("数据快照滚动失败：%v path=%s", err, s.filePath)
	}

	file, err := os.OpenFile(s.filePath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if chmodErr := file.Chmod(0o600); chmodErr != nil {
		logger.Warnf("设置数据快照文件权限失败：%v path=%s", chmodErr, s.filePath)
	}
	if _, writeErr := file.Write(append(payload, '\n')); writeErr != nil {
		_ = file.Close()
		return writeErr
	}
	if err := file.Close(); err != nil {
		return err
	}

	return s.pruneLocked()
}

// rotateLocked 超过体积上限时把当前文件滚到 .1。调用方须持有文件锁。
func (s *dmlSnapshotStore) rotateLocked() error {
	info, err := os.Stat(s.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Size() < dmlSnapshotFileMaxBytes {
		return nil
	}
	return os.Rename(s.filePath, s.filePath+".1")
}

// pruneLocked 按条数 + 天数裁剪。调用方须持有文件锁。
//
// 裁剪直接丢失还原能力，因此裁剪结果必须能被 UI 观察到（见 prunedBefore 字段），
// 不能静默丢弃。
func (s *dmlSnapshotStore) pruneLocked() error {
	entries, err := readDMLSnapshotEntries(s.filePath)
	if err != nil {
		return err
	}
	cutoff := time.Now().AddDate(0, 0, -dmlSnapshotRetentionDays)

	kept := make([]dmlSnapshotEntry, 0, len(entries))
	for _, entry := range entries {
		createdAt, parseErr := time.Parse(time.RFC3339, entry.CreatedAt)
		if parseErr == nil && createdAt.Before(cutoff) {
			continue
		}
		kept = append(kept, entry)
	}
	if len(kept) > dmlSnapshotMaxEntries {
		kept = kept[len(kept)-dmlSnapshotMaxEntries:]
	}
	if len(kept) == len(entries) {
		return nil
	}
	return writeDMLSnapshotEntries(s.filePath, kept)
}

// List 返回按时间倒序的快照条目。
func (s *dmlSnapshotStore) List() ([]dmlSnapshotEntry, error) {
	if s == nil {
		return nil, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	entries, err := readDMLSnapshotEntries(s.filePath)
	if err != nil {
		return nil, err
	}
	sort.SliceStable(entries, func(i, j int) bool {
		return entries[i].CreatedAt > entries[j].CreatedAt
	})
	return entries, nil
}

func readDMLSnapshotEntries(filePath string) ([]dmlSnapshotEntry, error) {
	file, err := os.Open(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	var entries []dmlSnapshotEntry
	scanner := bufio.NewScanner(file)
	// 单条快照可能很大，放宽 scanner 缓冲上限。
	scanner.Buffer(make([]byte, 0, 64*1024), dmlSnapshotMaxRecordBytes)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var entry dmlSnapshotEntry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			// 单行损坏不应该让整个快照中心不可读，跳过并留痕。
			logger.Warnf("跳过损坏的数据快照行：%v path=%s", err, filePath)
			continue
		}
		entries = append(entries, entry)
	}
	// 单行超长（> dmlSnapshotMaxRecordBytes）会被 scanner 截断报错，此时返回已解析的部分，
	// 不让一条异常记录把整个快照中心变成不可读。
	if err := scanner.Err(); err != nil {
		logger.Warnf("读取数据快照中断：%v path=%s", err, filePath)
	}
	return entries, nil
}

func writeDMLSnapshotEntries(filePath string, entries []dmlSnapshotEntry) error {
	tempPath := filePath + ".tmp"
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	writer := bufio.NewWriter(file)
	for _, entry := range entries {
		payload, marshalErr := json.Marshal(entry)
		if marshalErr != nil {
			_ = file.Close()
			_ = os.Remove(tempPath)
			return marshalErr
		}
		if _, writeErr := writer.Write(append(payload, '\n')); writeErr != nil {
			_ = file.Close()
			_ = os.Remove(tempPath)
			return writeErr
		}
	}
	if err := writer.Flush(); err != nil {
		_ = file.Close()
		_ = os.Remove(tempPath)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(tempPath)
		return err
	}
	// 先写临时文件再改名，避免裁剪过程中崩溃导致快照文件被截断。
	return os.Rename(tempPath, filePath)
}
