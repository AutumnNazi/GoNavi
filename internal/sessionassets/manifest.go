package sessionassets

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"GoNavi-Wails/internal/appdata"
)

// copyBufferSize 是流式复制与哈希的缓冲区大小：大文件不整份进内存。
const copyBufferSize = 1 << 20

// atomicReplace 使用 appdata 的平台持久化改名实现。
func atomicReplace(source, target string) error {
	return appdata.AtomicReplaceFile(source, target)
}

// copyMaterialFile 把来源文件流式复制到目标相对路径，同时计算 SHA-256 与
// 大小。目标以独占方式创建并落盘；来源声明的大小不符时中止复制（来源
// 可能仍在追加，此时候选不可信）。
func copyMaterialFile(relPath, sourcePath, generationDir string, expectedSize int64) (MaterialFileRecord, error) {
	targetPath := filepath.Join(generationDir, filepath.FromSlash(relPath))
	source, err := os.Open(sourcePath)
	if err != nil {
		return MaterialFileRecord{}, fmt.Errorf("open capture source %s: %w", filepath.Base(sourcePath), err)
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil {
		return MaterialFileRecord{}, fmt.Errorf("stat capture source %s: %w", filepath.Base(sourcePath), err)
	}
	if expectedSize > 0 && info.Size() != expectedSize {
		return MaterialFileRecord{}, fmt.Errorf("capture source %s size %d changed from expected %d: %w",
			filepath.Base(sourcePath), info.Size(), expectedSize, ErrSourceChanged)
	}
	if err := ensureDir(filepath.Dir(targetPath)); err != nil {
		return MaterialFileRecord{}, err
	}
	target, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return MaterialFileRecord{}, fmt.Errorf("create capture target %s: %w", filepath.Base(targetPath), err)
	}
	hasher := sha256.New()
	buffer := make([]byte, copyBufferSize)
	written, copyErr := io.CopyBuffer(io.MultiWriter(target, hasher), source, buffer)
	syncErr := target.Sync()
	closeErr := target.Close()
	if copyErr != nil {
		return MaterialFileRecord{}, fmt.Errorf("copy capture file %s: %w", filepath.Base(sourcePath), copyErr)
	}
	if syncErr != nil {
		return MaterialFileRecord{}, fmt.Errorf("sync capture file %s: %w", filepath.Base(targetPath), syncErr)
	}
	if closeErr != nil {
		return MaterialFileRecord{}, fmt.Errorf("close capture file %s: %w", filepath.Base(targetPath), closeErr)
	}
	if info.Size() != written {
		return MaterialFileRecord{}, fmt.Errorf("capture source %s grew during copy (%d -> %d): %w",
			filepath.Base(sourcePath), info.Size(), written, ErrSourceChanged)
	}
	return MaterialFileRecord{
		RelPath: filepath.ToSlash(relPath),
		Size:    written,
		SHA256:  hex.EncodeToString(hasher.Sum(nil)),
	}, nil
}

// writeManifestJSON 把清单写入 generationDir/manifest.json 并落盘。
func writeManifestJSON(generationDir string, manifest MaterialManifest) (string, error) {
	manifest.GenerationID = filepath.Base(generationDir)
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", fmt.Errorf("encode material manifest: %w", err)
	}
	path := filepath.Join(generationDir, manifestFileName)
	if err := writeFileSync(path, payload); err != nil {
		return "", err
	}
	return path, nil
}

// readManifestJSON 读取并解析代次清单。
func readManifestJSON(generationDir string) (MaterialManifest, error) {
	payload, err := os.ReadFile(filepath.Join(generationDir, manifestFileName))
	if err != nil {
		return MaterialManifest{}, fmt.Errorf("read material manifest: %w", err)
	}
	var manifest MaterialManifest
	if err := json.Unmarshal(payload, &manifest); err != nil {
		return MaterialManifest{}, fmt.Errorf("decode material manifest: %w", err)
	}
	return manifest, nil
}

// readCurrentPointer 读取资产的 latest 指针；不存在时返回零值与 false。
func readCurrentPointer(assetDir string) (CurrentPointer, bool, error) {
	payload, err := os.ReadFile(filepath.Join(assetDir, currentFileName))
	if errors.Is(err, os.ErrNotExist) {
		return CurrentPointer{}, false, nil
	}
	if err != nil {
		return CurrentPointer{}, false, fmt.Errorf("read current pointer: %w", err)
	}
	var pointer CurrentPointer
	if err := json.Unmarshal(payload, &pointer); err != nil {
		return CurrentPointer{}, false, fmt.Errorf("decode current pointer: %w", err)
	}
	return pointer, true, nil
}

// commitCurrentPointer 原子替换 latest 指针：这是提交事实的落点。
func commitCurrentPointer(assetDir string, pointer CurrentPointer) error {
	payload, err := json.MarshalIndent(pointer, "", "  ")
	if err != nil {
		return fmt.Errorf("encode current pointer: %w", err)
	}
	tempPath := filepath.Join(assetDir, currentFileName+".tmp")
	if err := writeFileSync(tempPath, payload); err != nil {
		return err
	}
	if err := atomicReplace(tempPath, filepath.Join(assetDir, currentFileName)); err != nil {
		return fmt.Errorf("replace current pointer: %w", err)
	}
	return nil
}

// verifyGenerationFiles 校验代次目录与清单一致：每个登记文件存在且哈希
// 匹配。恢复暂存候选与启动核对都走这条路径，损坏候选不得提交（V-11）。
func verifyGenerationFiles(generationDir string, manifest MaterialManifest) error {
	for _, record := range manifest.Files {
		path := filepath.Join(generationDir, filepath.FromSlash(record.RelPath))
		info, err := os.Stat(path)
		if err != nil {
			return fmt.Errorf("verify material %s: %w", record.RelPath, err)
		}
		if info.Size() != record.Size {
			return fmt.Errorf("material %s size %d does not match manifest %d: %w",
				record.RelPath, info.Size(), record.Size, ErrCandidateIncomplete)
		}
		sum, err := hashFile(path)
		if err != nil {
			return fmt.Errorf("hash material %s: %w", record.RelPath, err)
		}
		if sum != record.SHA256 {
			return fmt.Errorf("material %s hash mismatch: %w", record.RelPath, ErrCandidateIncomplete)
		}
	}
	return nil
}

// hashFile 计算文件 SHA-256。
func hashFile(path string) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hasher := sha256.New()
	if _, err := io.CopyBuffer(hasher, file, make([]byte, copyBufferSize)); err != nil {
		return "", err
	}
	return hex.EncodeToString(hasher.Sum(nil)), nil
}

// writeFileSync 以 0600 写入并落盘。
func writeFileSync(path string, payload []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	if _, err := file.Write(payload); err != nil {
		_ = file.Close()
		return fmt.Errorf("write %s: %w", filepath.Base(path), err)
	}
	if err := file.Sync(); err != nil {
		_ = file.Close()
		return fmt.Errorf("sync %s: %w", filepath.Base(path), err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close %s: %w", filepath.Base(path), err)
	}
	return nil
}
