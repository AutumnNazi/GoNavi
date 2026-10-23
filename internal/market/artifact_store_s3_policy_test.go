package market

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestNewS3StoreRejectsUnsafeConfiguration(t *testing.T) {
	cases := []struct {
		name   string
		change func(*S3Options)
	}{
		{"http requires opt in", func(o *S3Options) { o.AllowHTTP = false }},
		{"missing endpoint", func(o *S3Options) { o.Endpoint = "" }},
		{"endpoint credentials", func(o *S3Options) { o.Endpoint = "https://user:secret@example.com" }},
		{"endpoint query", func(o *S3Options) { o.Endpoint = "https://example.com?signed=bad" }},
		{"endpoint fragment", func(o *S3Options) { o.Endpoint = "https://example.com/#fragment" }},
		{"endpoint path", func(o *S3Options) { o.Endpoint = "https://example.com/../escape" }},
		{"endpoint double slash", func(o *S3Options) { o.Endpoint = "https://example.com//" }},
		{"prefix escape", func(o *S3Options) { o.Prefix = "../escape" }},
		{"region", func(o *S3Options) { o.Region = "region/scope" }},
		{"bucket", func(o *S3Options) { o.Bucket = "bucket/escape" }},
		{"access key", func(o *S3Options) { o.AccessKeyID = "key/scope" }},
		{"secret", func(o *S3Options) { o.SecretAccessKey = "" }},
		{"token injection", func(o *S3Options) { o.SessionToken = "token\r\nInjected: header" }},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			options := artifactTestS3Options("http://127.0.0.1:9000")
			test.change(&options)
			if _, err := NewS3Store(options); err == nil {
				t.Fatal("accepted invalid s3 configuration")
			}
		})
	}
}

func TestS3StoreNeverFollowsSignedRedirects(t *testing.T) {
	var redirected atomic.Int64
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { redirected.Add(1) }))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer source.Close()
	store, err := NewS3Store(artifactTestS3Options(source.URL))
	if err != nil {
		t.Fatal(err)
	}
	contents := []byte("expected")
	err = store.Put(context.Background(), artifactTestDigest(contents), bytes.NewReader(contents), int64(len(contents)))
	if err == nil || redirected.Load() != 0 {
		t.Fatalf("followed redirect or reported success: count=%d, err=%v", redirected.Load(), err)
	}
}

func TestS3StorePropagatesCancellation(t *testing.T) {
	entered := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-r.Context().Done()
	}))
	defer server.Close()
	store, err := NewS3Store(artifactTestS3Options(server.URL))
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	result := make(chan error, 1)
	go func() {
		_, err := store.Open(ctx, strings.Repeat("a", 64))
		result <- err
	}()
	<-entered
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled s3 request = %v", err)
	}
}

func TestS3StoreRejectsOversizedUploadResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		io.WriteString(w, strings.Repeat("x", (64<<10)+1))
	}))
	defer server.Close()
	store, err := NewS3Store(artifactTestS3Options(server.URL))
	if err != nil {
		t.Fatal(err)
	}
	body := []byte("expected")
	if err := store.Put(context.Background(), artifactTestDigest(body), bytes.NewReader(body), int64(len(body))); err == nil {
		t.Fatal("accepted unbounded upload response")
	}
}
