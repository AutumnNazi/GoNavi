package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

func staticFileInfo(root, entry string) (os.FileInfo, error) {
	if err := safeStaticPath(entry); err != nil {
		return nil, err
	}
	info, err := os.Lstat(root)
	if err != nil {
		return nil, fmt.Errorf("static source root is unavailable")
	}
	if !info.IsDir() || staticFileIsLink(info) {
		return nil, fmt.Errorf("static source root must be a regular directory")
	}
	current := root
	parts := strings.Split(entry, "/")
	for index, part := range parts {
		current = filepath.Join(current, part)
		info, err = os.Lstat(current)
		if err != nil {
			return nil, fmt.Errorf("static entry is unavailable")
		}
		if staticFileIsLink(info) {
			return nil, fmt.Errorf("static package links and reparse points are not supported")
		}
		if index < len(parts)-1 && !info.IsDir() {
			return nil, fmt.Errorf("static package parent must be a directory")
		}
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("static entry must be a regular file")
	}
	return info, nil
}

func readStaticFile(ctx context.Context, root, entry string, limit int64) ([]byte, error) {
	return readStaticFileUsing(ctx, root, entry, limit, openStaticFile)
}

func readStaticFileUsing(ctx context.Context, root, entry string, limit int64, open func(string) (*os.File, error)) ([]byte, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	before, err := staticFileInfo(root, entry)
	if err != nil {
		return nil, err
	}
	if before.Size() > limit {
		return nil, fmt.Errorf("static entry exceeds byte limit")
	}
	file, err := open(filepath.Join(root, filepath.FromSlash(entry)))
	if err != nil {
		return nil, fmt.Errorf("static entry is unavailable")
	}
	defer file.Close()
	opened, err := file.Stat()
	if err != nil {
		return nil, fmt.Errorf("static entry is unavailable")
	}
	if !opened.Mode().IsRegular() || !os.SameFile(before, opened) {
		return nil, fmt.Errorf("static entry changed before opening")
	}
	body, err := io.ReadAll(io.LimitReader(staticContextReader{ctx: ctx, reader: file}, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(body)) > limit {
		return nil, fmt.Errorf("static entry exceeds byte limit")
	}
	after, err := staticFileInfo(root, entry)
	if err != nil {
		return nil, err
	}
	if !os.SameFile(before, after) || after.Size() != int64(len(body)) || !before.ModTime().Equal(after.ModTime()) {
		return nil, fmt.Errorf("static entry changed while reading")
	}
	return body, nil
}

func writeStaticFile(path string, body []byte) error {
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	defer file.Close()
	count, err := file.Write(body)
	if err != nil {
		return err
	}
	if count != len(body) {
		return io.ErrShortWrite
	}
	if err = file.Sync(); err != nil {
		return err
	}
	return file.Close()
}

type staticContextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r staticContextReader) Read(buffer []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(buffer)
}
