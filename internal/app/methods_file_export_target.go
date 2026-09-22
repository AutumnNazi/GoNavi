package app

// 桌面导出目标文件的原子提交机制：导出全程写入目标同目录的 .gonavi-export-*.part
// 临时文件，成功路径 commit（fsync + 原子改名），取消或失败路径 abort（关闭并删除），
// 保证目标位置要么是完整文件、要么什么都没有。

import (
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
)

type atomicExportFile interface {
	io.Writer
	io.Closer
	Sync() error
}

type atomicExportTarget struct {
	file       atomicExportFile
	tempPath   string
	targetPath string
	closed     bool
	committed  bool
}

func createAtomicExportTarget(targetPath string, budgets ...*webTransferBudget) (*atomicExportTarget, error) {
	temporary, err := os.CreateTemp(filepath.Dir(targetPath), ".gonavi-export-*.part")
	if err != nil {
		return nil, err
	}
	var file atomicExportFile = temporary
	if len(budgets) > 0 && budgets[0] != nil {
		file, err = newWebTransferFile(temporary, budgets[0])
		if err != nil {
			_ = temporary.Close()
			_ = os.Remove(temporary.Name())
			return nil, err
		}
	}
	return &atomicExportTarget{
		file:       file,
		tempPath:   temporary.Name(),
		targetPath: targetPath,
	}, nil
}

func (target *atomicExportTarget) abort() {
	if target == nil {
		return
	}
	if !target.closed {
		_ = target.file.Close()
		target.closed = true
	}
	if !target.committed {
		_ = os.Remove(target.tempPath)
	}
}

// commit 提交导出：fsync、关闭、原子改名。ctx 用于取消复核——大文件 fsync
// 可达秒级，取消若发生在 Sync/Close 期间，第二次复核会阻止把完整文件改名
// 发布到目标位置（调用方随后走 abort 清理临时文件）。
func (target *atomicExportTarget) commit(ctx context.Context) error {
	if target == nil || target.file == nil {
		return errors.New("invalid atomic export target")
	}
	if err := target.file.Sync(); err != nil {
		return err
	}
	closeErr := target.file.Close()
	target.closed = true
	if closeErr != nil {
		return closeErr
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	if err := atomicReplaceSQLAuditFile(target.tempPath, target.targetPath); err != nil {
		return err
	}
	target.committed = true
	return nil
}
