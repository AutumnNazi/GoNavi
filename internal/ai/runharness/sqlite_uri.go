package runharness

import (
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
)

// SQLiteFileURI builds a SQLite file DSN. On Windows a drive path must be
// written as file:///C:/... . url.URL turns "C:/..." into file://C:/..., which
// modernc.org/sqlite reports as "SQL logic error: out of memory".
func SQLiteFileURI(path string, query url.Values) (string, error) {
	absPath, err := filepath.Abs(strings.TrimSpace(path))
	if err != nil {
		return "", fmt.Errorf("resolve sqlite path: %w", err)
	}
	uri := &url.URL{Scheme: "file", Path: filepath.ToSlash(absPath)}
	if runtime.GOOS == "windows" && !strings.HasPrefix(uri.Path, "/") {
		uri.Path = "/" + uri.Path
	}
	if len(query) > 0 {
		uri.RawQuery = query.Encode()
	}
	return uri.String(), nil
}
