package sessionagent

// 本文件是 Codex rollout 文件的透明读取层：.jsonl 与 .jsonl.zst 双形态
// 处理。参考 cc-switch src-tauri/src/codex_rollout_file.rs。

import (
	"bufio"
	"io"
	"os"
	"path/filepath"
	"strings"

	"github.com/klauspost/compress/zstd"
)

const (
	plainSuffix      = ".jsonl"
	compressedSuffix = ".jsonl.zst"
)

// IsRolloutFile 判断文件名是否为 rollout 会话文件（.jsonl 或
// .jsonl.zst；裸 .zst 不认）。
func IsRolloutFile(name string) bool {
	return strings.HasSuffix(name, plainSuffix) || strings.HasSuffix(name, compressedSuffix)
}

// IsCompressedRollout 判断文件名是否为 zstd 压缩形态。
func IsCompressedRollout(name string) bool {
	return strings.HasSuffix(name, compressedSuffix)
}

// RolloutSibling 返回同名另一形态路径（.jsonl ↔ .jsonl.zst）。
// 双形态并存时压缩/未压缩是同一逻辑会话，删除需联动。
func RolloutSibling(path string) string {
	if IsCompressedRollout(path) {
		return strings.TrimSuffix(path, compressedSuffix) + plainSuffix
	}
	return path + compressedSuffix
}

// OpenRollout 返回 rollout 文件的逐行读取器：.jsonl.zst 走 zstd 流式
// 解压（1MiB 缓冲），普通文件直读。
func OpenRollout(path string) (io.ReadCloser, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	if !IsCompressedRollout(path) {
		return file, nil
	}
	decoder, err := zstd.NewReader(file)
	if err != nil {
		file.Close()
		return nil, err
	}
	return &zstdReadCloser{Reader: decoder, closer: file}, nil
}

type zstdReadCloser struct {
	io.Reader
	closer io.Closer
}

func (z *zstdReadCloser) Close() error {
	if closer, ok := z.Reader.(io.Closer); ok {
		closer.Close()
	}
	return z.closer.Close()
}

// DedupeRolloutSiblings 去重双形态：同一逻辑名保留 .jsonl（Codex 正在
// 写、内容更全），保持输入顺序。
func DedupeRolloutSiblings(paths []string) []string {
	hasPlain := map[string]bool{}
	for _, p := range paths {
		if !IsCompressedRollout(p) {
			hasPlain[logicalName(p)] = true
		}
	}
	seen := map[string]bool{}
	result := make([]string, 0, len(paths))
	for _, p := range paths {
		name := logicalName(p)
		if seen[name] {
			continue
		}
		if IsCompressedRollout(p) && hasPlain[name] {
			continue
		}
		seen[name] = true
		result = append(result, p)
	}
	return result
}

func logicalName(path string) string {
	if IsCompressedRollout(path) {
		return strings.TrimSuffix(path, compressedSuffix)
	}
	return strings.TrimSuffix(path, plainSuffix)
}

// CollectRolloutFiles 递归收集目录下全部 rollout 文件并去重双形态。
func CollectRolloutFiles(root string) []string {
	var files []string
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return nil // 单个目录/文件不可读不中断整体扫描
		}
		if entry.IsDir() {
			return nil
		}
		if IsRolloutFile(entry.Name()) {
			files = append(files, path)
		}
		return nil
	})
	return DedupeRolloutSiblings(files)
}

// readScanner 是 bufio.Scanner 的公共构造（行上限与 codex 历史读取一致）。
func readScanner(r io.Reader) *bufio.Scanner {
	scanner := bufio.NewScanner(r)
	scanner.Buffer(make([]byte, 0, 64*1024), 32*1024*1024)
	return scanner
}
