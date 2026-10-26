package market

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"unicode"
	"unicode/utf8"
)

// MaxArtifactBytes is the maximum compressed package or stored artifact size.
const MaxArtifactBytes = 64 << 20

const (
	maxArtifactExpandedBytes = 256 << 20
	maxArtifactManifestBytes = 256 << 10
	maxArtifactFiles         = 4096
	maxArtifactPaths         = maxArtifactFiles * 16
	artifactManifestName     = "gonavi.plugin.json"
)

// ValidatedPackage describes exact archive bytes inspected without running code.
type ValidatedPackage struct {
	Manifest                               json.RawMessage
	ID, Name, Version, Description, Author string
	MinHostVersion                         string
	Platforms                              []string
	SHA256                                 string
	SizeBytes                              int64
}

// ValidatePackage validates a ZIP or TGZ snapshot, including every entry's data.
// It neither extracts files nor executes scripts, interpreters, or native code.
func ValidatePackage(ctx context.Context, filename string) (ValidatedPackage, error) {
	if err := ctx.Err(); err != nil {
		return ValidatedPackage{}, err
	}
	info, err := os.Lstat(filename)
	if err != nil {
		return ValidatedPackage{}, fmt.Errorf("stat artifact failed")
	}
	if !info.Mode().IsRegular() || info.Size() <= 0 || info.Size() > MaxArtifactBytes {
		return ValidatedPackage{}, fmt.Errorf("artifact must be a regular file of 1 to %d bytes", MaxArtifactBytes)
	}
	f, err := os.Open(filename)
	if err != nil {
		return ValidatedPackage{}, fmt.Errorf("open artifact failed")
	}
	defer f.Close()
	opened, err := f.Stat()
	if err != nil {
		return ValidatedPackage{}, fmt.Errorf("stat opened artifact: %w", err)
	}
	if !os.SameFile(info, opened) {
		return ValidatedPackage{}, fmt.Errorf("artifact changed while opening")
	}
	data, err := io.ReadAll(io.LimitReader(artifactContextReader{ctx, f}, MaxArtifactBytes+1))
	if err != nil {
		return ValidatedPackage{}, fmt.Errorf("read artifact failed")
	}
	if len(data) == 0 || len(data) > MaxArtifactBytes {
		return ValidatedPackage{}, fmt.Errorf("artifact exceeds compressed size limit")
	}
	index := artifactIndex{paths: make(map[string]artifactPath)}
	switch lower := strings.ToLower(filename); {
	case strings.HasSuffix(lower, ".zip"):
		err = index.readZIP(ctx, data)
	case strings.HasSuffix(lower, ".tgz"), strings.HasSuffix(lower, ".tar.gz"):
		err = index.readTGZ(ctx, data)
	default:
		err = fmt.Errorf("unsupported artifact format: expected zip, tgz, or tar.gz")
	}
	if err != nil {
		return ValidatedPackage{}, err
	}
	validated, err := index.validateManifest(ctx)
	if err != nil {
		return ValidatedPackage{}, err
	}
	digest := sha256.Sum256(data)
	validated.SHA256 = hex.EncodeToString(digest[:])
	validated.SizeBytes = int64(len(data))
	return validated, nil
}

type artifactContextReader struct {
	ctx    context.Context
	source io.Reader
}

func (r artifactContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := r.source.Read(p)
	if canceled := r.ctx.Err(); canceled != nil {
		return n, canceled
	}
	return n, err
}

type artifactPath struct {
	name      string
	directory bool
	explicit  bool
}

type artifactIndex struct {
	skillDocuments map[string]bool
	paths          map[string]artifactPath
	manifest       json.RawMessage
	files          int
	expanded       int64
}

func safeArtifactPath(name string) error {
	if name == "" || len(name) > 1024 || strings.Count(name, "/") > 32 || !utf8.ValidString(name) || strings.ContainsAny(name, "\\:\x00<>\"|?*") {
		return fmt.Errorf("invalid artifact path")
	}
	if path.IsAbs(name) || path.Clean(name) != name || name == "." || name == ".." || strings.HasPrefix(name, "../") {
		return fmt.Errorf("non-relative or unclean artifact path")
	}
	for _, part := range strings.Split(name, "/") {
		if len(part) > 240 || strings.TrimRight(part, ". ") != part || strings.ContainsFunc(part, unicode.IsControl) {
			return fmt.Errorf("unsafe artifact path component")
		}
		base := strings.ToUpper(strings.TrimRight(strings.SplitN(part, ".", 2)[0], " "))
		if base == "CON" || base == "PRN" || base == "AUX" || base == "NUL" || base == "CLOCK$" || base == "CONIN$" || base == "CONOUT$" ||
			(len(base) == 4 && (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) && base[3] >= '0' && base[3] <= '9') {
			return fmt.Errorf("reserved artifact path component")
		}
		if (strings.HasPrefix(base, "COM") || strings.HasPrefix(base, "LPT")) &&
			(base[3:] == "¹" || base[3:] == "²" || base[3:] == "³") {
			return fmt.Errorf("reserved artifact path component")
		}
	}
	return nil
}

// SimpleFold also catches Unicode aliases such as the Kelvin sign and final sigma.
func foldArtifactPath(name string) string {
	return strings.Map(func(r rune) rune {
		minimum := r
		for folded := unicode.SimpleFold(r); folded != r; folded = unicode.SimpleFold(folded) {
			if folded < minimum {
				minimum = folded
			}
		}
		return minimum
	}, name)
}

func (index *artifactIndex) add(name string, directory bool, size int64) error {
	index.files++
	if index.files > maxArtifactFiles || size < 0 || size > maxArtifactExpandedBytes-index.expanded {
		return fmt.Errorf("artifact exceeds file count or expanded size limit")
	}
	if directory {
		name = strings.TrimSuffix(name, "/")
		if size != 0 {
			return fmt.Errorf("artifact directory contains data")
		}
	}
	if err := safeArtifactPath(name); err != nil {
		return err
	}
	for parent := path.Dir(name); parent != "."; parent = path.Dir(parent) {
		key := foldArtifactPath(parent)
		if previous, found := index.paths[key]; found && (!previous.directory || previous.name != parent) {
			return fmt.Errorf("artifact path conflicts with parent")
		}
		if _, found := index.paths[key]; !found {
			index.paths[key] = artifactPath{name: parent, directory: true}
		}
		if len(index.paths) > maxArtifactPaths {
			return fmt.Errorf("artifact exceeds total path limit")
		}
	}
	key := foldArtifactPath(name)
	if previous, found := index.paths[key]; found && (previous.explicit || !directory || previous.name != name) {
		return fmt.Errorf("duplicate or conflicting artifact path")
	}
	index.paths[key] = artifactPath{name: name, directory: directory, explicit: true}
	if len(index.paths) > maxArtifactPaths {
		return fmt.Errorf("artifact exceeds total path limit")
	}
	index.expanded += size
	if name == artifactManifestName && (directory || size > maxArtifactManifestBytes) {
		return fmt.Errorf("manifest must be a regular file of at most %d bytes", maxArtifactManifestBytes)
	}
	return nil
}

func (index *artifactIndex) readEntry(ctx context.Context, name string, size int64, r io.Reader) error {
	reader := io.LimitReader(artifactContextReader{ctx, r}, size+1)
	if name == artifactManifestName {
		contents, err := io.ReadAll(reader)
		if err != nil {
			return fmt.Errorf("read manifest: %w", err)
		}
		if int64(len(contents)) != size {
			return fmt.Errorf("manifest size differs from archive header")
		}
		index.manifest = bytes.Clone(contents)
		return nil
	}
	if isArtifactMarkdown(name) && size > 0 && size <= maxArtifactSkillBytes {
		return index.readSkillDocumentCandidate(name, size, reader)
	}
	n, err := io.Copy(io.Discard, reader)
	if err != nil {
		return fmt.Errorf("read artifact entry failed")
	}
	if n != size {
		return fmt.Errorf("entry size differs from archive header")
	}
	return nil
}
