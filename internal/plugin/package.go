package plugin

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
)

const maxPackageBytes int64 = 256 << 20
const maxFileBytes int64 = 64 << 20
const maxPackageEntries = 4096

type packageFile struct {
	name string
	size int64
	hash string
}
type packageScan struct {
	ctx          context.Context
	destination  string
	seen         map[string]bool
	pathCase     map[string]string
	filePaths    map[string]bool
	files        []packageFile
	manifest     []byte
	total        int64
	entries      int
	skillFiles   map[string]error
	captureSkill string
	skillContent []byte
}

// InspectPackage validates a local directory, ZIP, or TGZ without executing any code.
// Digest is SHA-256 over sorted portable paths, lengths and file content hashes.
func InspectPackage(ctx context.Context, source string) (Inspection, error) {
	return scanPackage(ctx, source, "")
}
func scanPackage(ctx context.Context, source, destination string) (Inspection, error) {
	var result Inspection
	absolute, err := filepath.Abs(source)
	if err != nil {
		return result, fmt.Errorf("resolve package: %w", err)
	}
	info, err := os.Lstat(absolute)
	if err != nil {
		return result, fmt.Errorf("stat package failed")
	}
	scan := &packageScan{ctx: ctx, destination: destination, seen: make(map[string]bool)}
	switch {
	case info.IsDir():
		err = scan.directory(absolute)
	case info.Mode().IsRegular():
		if info.Size() > maxPackageBytes {
			return result, fmt.Errorf("archive exceeds compressed size limit")
		}
		format, formatErr := archiveFormat(absolute)
		if formatErr != nil {
			return result, formatErr
		}
		switch format {
		case "zip":
			err = scan.zip(absolute)
		case "tgz":
			err = scan.tgz(absolute)
		}
	default:
		err = fmt.Errorf("package must be a regular directory or archive")
	}
	if err != nil {
		return result, err
	}
	return scan.finish(absolute)
}

func (s *packageScan) finish(source string) (Inspection, error) {
	if err := s.ctx.Err(); err != nil {
		return Inspection{}, err
	}
	manifest, err := ParseManifest(s.manifest)
	if err != nil {
		return Inspection{}, err
	}
	if err = s.validateEntries(manifest); err != nil {
		return Inspection{}, err
	}
	sort.Slice(s.files, func(i, j int) bool { return s.files[i].name < s.files[j].name })
	digest := sha256.New()
	for _, f := range s.files {
		if _, err = fmt.Fprintf(digest, "%s\x00%d\x00%s\n", f.name, f.size, f.hash); err != nil {
			return Inspection{}, err
		}
	}
	return Inspection{Manifest: manifest, Digest: hex.EncodeToString(digest.Sum(nil)), SourcePath: source, SizeBytes: s.total}, nil
}
func (s *packageScan) entry(name string, dir bool) error {
	if err := s.ctx.Err(); err != nil {
		return err
	}
	s.entries++
	if s.entries > maxPackageEntries {
		return fmt.Errorf("package contains too many entries")
	}
	if err := safePackagePath(name); err != nil {
		return err
	}
	if err := s.registerPath(name, dir); err != nil {
		return err
	}
	key := strings.ToLower(name)
	if s.seen[key] {
		return fmt.Errorf("duplicate or case-colliding package path")
	}
	s.seen[key] = true
	return nil
}
func (s *packageScan) file(name string, size int64, r io.Reader) error {
	if size < 0 || size > maxFileBytes || s.total+size > maxPackageBytes {
		return fmt.Errorf("package file exceeds size limit")
	}
	if name == manifestName && size > maxManifestBytes {
		return fmt.Errorf("manifest exceeds size limit")
	}
	if err := s.entry(name, false); err != nil {
		return err
	}
	hash := sha256.New()
	var capture bytes.Buffer
	writers := []io.Writer{hash}
	if name == manifestName || (isSkillDocument(name) && size <= maxSkillBytes) {
		writers = append(writers, &capture)
	}
	var target *os.File
	if s.destination != "" {
		full := filepath.Join(s.destination, filepath.FromSlash(name))
		if err := os.MkdirAll(filepath.Dir(full), 0700); err != nil {
			return err
		}
		var err error
		target, err = os.OpenFile(full, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			return err
		}
		writers = append(writers, target)
	}
	n, copyErr := io.Copy(io.MultiWriter(writers...), io.LimitReader(contextReader{ctx: s.ctx, reader: r}, size+1))
	if target != nil {
		if copyErr == nil {
			copyErr = target.Sync()
		}
		if closeErr := target.Close(); copyErr == nil {
			copyErr = closeErr
		}
	}
	if copyErr != nil {
		return fmt.Errorf("read package file failed")
	}
	if n != size {
		return fmt.Errorf("package file changed or has inconsistent size")
	}
	s.total += n
	s.files = append(s.files, packageFile{name: name, size: n, hash: hex.EncodeToString(hash.Sum(nil))})
	if name == manifestName {
		s.manifest = capture.Bytes()
	}
	if isSkillDocument(name) {
		s.recordSkillFile(name, size, capture.Bytes())
	}
	return nil
}
func (s *packageScan) directory(source string) error {
	// The selected source may have user-chosen ancestor aliases; its final component must not be a link.
	parent, err := canonicalPackageDirectory(filepath.Dir(source))
	if err != nil {
		return err
	}
	root, err := openPackageDirectory(s.ctx, filepath.Join(parent, filepath.Base(source)))
	if err != nil {
		return err
	}
	defer root.Close()
	return s.directoryHandle(root, "")
}
func (s *packageScan) validateEntries(m Manifest) error {
	regular := make(map[string]bool, len(s.files))
	for _, f := range s.files {
		regular[f.name] = true
	}
	check := func(name string) error {
		if !regular[name] {
			return fmt.Errorf("declared entry is not a regular package file; build the native binary and check the packaged output instead of the source tree")
		}
		return nil
	}
	if m.Backend != nil {
		if m.Backend.Default != nil {
			if err := check(m.Backend.Default.Executable); err != nil {
				return err
			}
		}
		for _, e := range m.Backend.Platforms {
			if err := check(e.Executable); err != nil {
				return err
			}
		}
	}
	if m.Window != nil {
		if err := check(m.Window.Entry); err != nil {
			return err
		}
	}
	return s.validateSkillEntries(m)
}
func safePackagePath(name string) error {
	if name == "" || len(name) > 1024 || strings.Count(name, "/") > 32 || strings.ContainsAny(name, "\\:\x00<>\"|?*") || path.IsAbs(name) || path.Clean(name) != name {
		return fmt.Errorf("unsafe package path")
	}
	for _, char := range name {
		if char < 32 {
			return fmt.Errorf("control character in package path")
		}
	}
	for _, part := range strings.Split(name, "/") {
		if part == "." || part == ".." || len(part) > 240 || strings.TrimRight(part, " .") != part {
			return fmt.Errorf("unsafe package path segment")
		}
		base := strings.ToUpper(strings.SplitN(part, ".", 2)[0])
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || base == "CLOCK$" || base == "CONIN$" || base == "CONOUT$" || reservedPort(base) {
			return fmt.Errorf("reserved package path")
		}
	}
	return nil
}

type contextReader struct {
	ctx    context.Context
	reader io.Reader
}

func (r contextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.reader.Read(p)
}
