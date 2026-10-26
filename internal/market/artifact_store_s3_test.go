package market

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func artifactTestS3Options(endpoint string) S3Options {
	return S3Options{
		Endpoint: endpoint, Region: "us-east-1", Bucket: "artifact-bucket",
		AccessKeyID: "test-access-key", SecretAccessKey: "test-secret-key", SessionToken: "test/session+token=",
		AllowHTTP: true, Clock: func() time.Time { return time.Date(2026, 10, 19, 12, 0, 0, 0, time.UTC) },
	}
}

func TestS3StoreConditionalRoundTripAndIntegrity(t *testing.T) {
	contents := []byte("immutable s3 object bytes")
	digest := artifactTestDigest(contents)
	var mu sync.Mutex
	objects := make(map[string][]byte)
	var requests atomic.Int64
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		if !checkArtifactS3TestHeaders(t, r, digest) {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodGet {
			body, exists := objects[digest]
			if !exists {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			if _, err := w.Write(body); err != nil {
				t.Error(err)
			}
			return
		}
		body, err := io.ReadAll(r.Body)
		checksum, decodeErr := hex.DecodeString(digest)
		if err != nil || decodeErr != nil || artifactTestDigest(body) != digest || r.Header.Get("If-None-Match") != "*" || r.Header.Get("X-Amz-Checksum-Sha256") != base64.StdEncoding.EncodeToString(checksum) {
			t.Errorf("invalid s3 upload: %v, %v", err, decodeErr)
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if _, exists := objects[digest]; exists {
			w.WriteHeader(http.StatusPreconditionFailed)
			return
		}
		objects[digest] = body
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()
	options := artifactTestS3Options(server.URL + "/service")
	options.Prefix = "releases/a b+/☃"
	store, err := NewS3Store(options)
	if err != nil {
		t.Fatal(err)
	}
	for range 2 {
		if err := store.Put(context.Background(), digest, bytes.NewReader(contents), int64(len(contents))); err != nil {
			t.Fatal(err)
		}
	}
	reader, err := store.Open(context.Background(), digest)
	if err != nil {
		t.Fatal(err)
	}
	actual, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil || closeErr != nil || !bytes.Equal(actual, contents) {
		t.Fatalf("s3 round trip: %q, %v, %v", actual, readErr, closeErr)
	}
	before := requests.Load()
	if err := store.Put(context.Background(), digest, bytes.NewReader([]byte("wrong bytes")), 11); err == nil || requests.Load() != before {
		t.Fatal("mismatched source reached s3")
	}
	mu.Lock()
	objects[digest] = []byte("corrupt existing key")
	mu.Unlock()
	if err := store.Put(context.Background(), digest, bytes.NewReader(contents), int64(len(contents))); err == nil {
		t.Fatal("accepted corrupt existing s3 key")
	}
	mu.Lock()
	defer mu.Unlock()
	if string(objects[digest]) != "corrupt existing key" {
		t.Fatal("overwrote existing key")
	}
}

func checkArtifactS3TestHeaders(t *testing.T, request *http.Request, digest string) bool {
	t.Helper()
	expected := "/service/artifact-bucket/releases/a%20b%2B/%E2%98%83/" + digest
	authorization := request.Header.Get("Authorization")
	if request.RequestURI != expected || !strings.HasPrefix(authorization, "AWS4-HMAC-SHA256 Credential=test-access-key/20261019/us-east-1/s3/aws4_request,") ||
		!strings.Contains(authorization, "x-amz-security-token") || request.Header.Get("X-Amz-Security-Token") != "test/session+token=" || request.Header.Get("X-Amz-Date") != "20261019T120000Z" {
		t.Errorf("incorrect signed request path or headers: %s", request.RequestURI)
		return false
	}
	if request.Method == http.MethodGet && request.Header.Get("X-Amz-Content-Sha256") != artifactTestDigest(nil) {
		t.Error("get payload must use the empty hash")
		return false
	}
	return true
}

func TestS3StoreRejectsHTTPFailuresAndFalseSuccess(t *testing.T) {
	body := []byte("expected")
	digest := artifactTestDigest(body)
	cases := []struct {
		name      string
		putStatus int
		getStatus int
		getBody   string
	}{
		{"forbidden", 403, 200, "expected"}, {"conflict", 409, 200, "expected"},
		{"false success", 200, 404, ""}, {"false precondition", 412, 404, ""},
		{"wrong bytes", 200, 200, "tampered"}, {"wrong existing bytes", 412, 200, "tampered"},
		{"wrong get status", 200, 206, "expected"},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPut {
					w.WriteHeader(test.putStatus)
					fmt.Fprint(w, "do-not-echo-service-secret")
					return
				}
				w.WriteHeader(test.getStatus)
				fmt.Fprint(w, test.getBody)
			}))
			defer server.Close()
			store, err := NewS3Store(artifactTestS3Options(server.URL))
			if err != nil {
				t.Fatal(err)
			}
			err = store.Put(context.Background(), digest, bytes.NewReader(body), int64(len(body)))
			if err == nil || strings.Contains(err.Error(), "do-not-echo-service-secret") {
				t.Fatalf("false success or leaked response: %v", err)
			}
		})
	}
}

func TestS3StoreMissingOversizedAndEncodedObjects(t *testing.T) {
	for _, mode := range []string{"missing", "oversized", "encoded", "empty", "truncated"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch mode {
				case "missing":
					w.WriteHeader(http.StatusNotFound)
				case "oversized":
					w.Header().Set("Content-Length", fmt.Sprint(MaxArtifactBytes+1))
				case "encoded":
					w.Header().Set("Content-Encoding", "gzip")
					fmt.Fprint(w, "expected")
				case "truncated":
					w.Header().Set("Content-Length", "100")
					fmt.Fprint(w, "expected")
				}
			}))
			defer server.Close()
			store, err := NewS3Store(artifactTestS3Options(server.URL))
			if err != nil {
				t.Fatal(err)
			}
			_, err = store.Open(context.Background(), artifactTestDigest([]byte("expected")))
			if err == nil || (mode == "missing" && !errors.Is(err, os.ErrNotExist)) {
				t.Fatalf("invalid s3 read = %v", err)
			}
		})
	}
}
