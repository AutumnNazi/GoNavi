package backgroundgallery

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

type cancelDuringRead struct {
	cancel  context.CancelFunc
	payload []byte
	err     error
}

func (r cancelDuringRead) Read(p []byte) (int, error) {
	if r.cancel != nil {
		r.cancel()
	}
	return copy(p, r.payload), r.err
}

func TestStreamAssetCancellationDuringRead(t *testing.T) {
	expected := []byte("valid bytes")
	sum := sha256.Sum256(expected)
	asset := Asset{SizeBytes: int64(len(expected)), SHA256: hex.EncodeToString(sum[:])}
	for _, tc := range []struct {
		name    string
		payload []byte
		readErr error
	}{
		{"empty eof", nil, io.EOF},
		{"partial eof", []byte("valid"), io.EOF},
		{"complete eof", expected, io.EOF},
		{"transport error", nil, io.ErrClosedPipe},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			file, err := os.CreateTemp(t.TempDir(), "download-*")
			if err != nil {
				t.Fatal(err)
			}
			defer file.Close()
			err = streamAsset(ctx, file, cancelDuringRead{cancel: cancel, payload: tc.payload, err: tc.readErr}, asset, nil)
			if !errors.Is(err, context.Canceled) || ErrorCode(err) != "canceled" {
				t.Fatalf("cancel during read returned %v (%s)", err, ErrorCode(err))
			}
		})
	}
}

func TestStreamAssetCancellationFromFinalProgress(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	file, err := os.CreateTemp(t.TempDir(), "download-*")
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	asset := Asset{SizeBytes: 3, SHA256: strings.Repeat("0", 64)}
	err = streamAsset(ctx, file, cancelDuringRead{payload: []byte("abc"), err: io.EOF}, asset, func(Progress) { cancel() })
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("progress cancellation returned %v", err)
	}
}

func TestDownloadCanceledEOFLeavesNoInstallation(t *testing.T) {
	payload, entry := syntheticPNG(t)
	service, _, root := galleryFixture(t, []Entry{entry}, func(http.ResponseWriter, *http.Request) { t.Error("unexpected fixture asset request") })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	service.client.Transport = storageTransport(func(request *http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: http.StatusOK, Header: http.Header{"Content-Type": []string{"image/png"}}, ContentLength: entry.Image.SizeBytes, Body: io.NopCloser(cancelDuringRead{cancel: cancel, payload: payload[:3], err: io.EOF}), Request: request}, nil
	})
	_, err := service.Download(ctx, entry.ID, entry.Version, nil)
	if !errors.Is(err, context.Canceled) || ErrorCode(err) != "canceled" {
		t.Fatalf("download cancellation returned %v (%s)", err, ErrorCode(err))
	}
	state, err := service.Status()
	if err != nil || len(state.Installed) != 0 {
		t.Fatalf("partial installation: %+v, %v", state, err)
	}
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if strings.HasPrefix(entry.Name(), ".gallery-") {
			t.Errorf("temporary download remains: %s", path)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
