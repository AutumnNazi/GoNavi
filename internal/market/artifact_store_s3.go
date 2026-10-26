package market

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"
	"unicode"
)

// S3Options configures a path-style S3 endpoint with explicitly supplied
// credentials. SessionToken is supported; credential discovery/refresh is not.
// HTTP requires AllowHTTP, intended for local development. Clock is optional.
type S3Options struct {
	Endpoint, Region, Bucket, Prefix           string
	AccessKeyID, SecretAccessKey, SessionToken string
	HTTPClient                                 *http.Client
	AllowHTTP                                  bool
	Clock                                      func() time.Time
}

// S3Store uses signed, bounded single-object requests, conditional immutable
// writes, and full GET hash verification. The server must implement S3's atomic
// If-None-Match: * semantics. It does not configure bucket policies, Object Lock,
// multipart uploads, directory buckets, retries, or credential refresh.
type S3Store struct {
	endpoint *url.URL
	options  S3Options
	client   *http.Client
}

var _ ArtifactStore = (*S3Store)(nil)

var (
	artifactS3BucketPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)
	artifactS3RegionPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,62}$`)
	artifactS3KeyPattern    = regexp.MustCompile(`^[A-Za-z0-9_-]{1,128}$`)
)

// NewS3Store constructs a real standard-library SigV4 adapter. Endpoint must be
// the regional service URL, without a bucket, credentials, query, or fragment.
// An optional endpoint base path and a safe object Prefix are supported.
func NewS3Store(options S3Options) (*S3Store, error) {
	if !artifactS3RegionPattern.MatchString(options.Region) || !artifactS3BucketPattern.MatchString(options.Bucket) || strings.Contains(options.Bucket, "..") {
		return nil, fmt.Errorf("invalid s3 region or bucket")
	}
	if !artifactS3KeyPattern.MatchString(options.AccessKeyID) || options.SecretAccessKey == "" || len(options.SecretAccessKey) > 4096 ||
		strings.ContainsFunc(options.SecretAccessKey, unicode.IsControl) || strings.TrimSpace(options.SecretAccessKey) != options.SecretAccessKey ||
		len(options.SessionToken) > 16384 || strings.ContainsFunc(options.SessionToken, unicode.IsControl) || strings.TrimSpace(options.SessionToken) != options.SessionToken {
		return nil, fmt.Errorf("invalid s3 credentials")
	}
	endpoint, err := url.Parse(options.Endpoint)
	if err != nil || endpoint.Hostname() == "" || endpoint.User != nil || endpoint.RawQuery != "" || endpoint.ForceQuery || endpoint.Fragment != "" || endpoint.Opaque != "" {
		return nil, fmt.Errorf("invalid s3 endpoint")
	}
	if endpoint.Scheme != "https" && !(endpoint.Scheme == "http" && options.AllowHTTP) {
		return nil, fmt.Errorf("s3 endpoint requires https or explicit allow-http")
	}
	endpoint.Path = strings.TrimSuffix(endpoint.Path, "/")
	if endpoint.Path == "/" {
		return nil, fmt.Errorf("invalid s3 endpoint base path")
	}
	if base := strings.TrimPrefix(endpoint.Path, "/"); base != "" {
		if err := safeArtifactPath(base); err != nil {
			return nil, fmt.Errorf("invalid s3 endpoint base path: %w", err)
		}
	}
	if options.Prefix != "" {
		if err := safeArtifactPath(options.Prefix); err != nil {
			return nil, fmt.Errorf("invalid s3 prefix: %w", err)
		}
	}
	if options.Clock == nil {
		options.Clock = time.Now
	}
	client := http.Client{Timeout: 30 * time.Second}
	if options.HTTPClient != nil {
		client = *options.HTTPClient
		if client.Timeout <= 0 {
			client.Timeout = 30 * time.Second
		}
	}
	// Signed credentials must never follow a redirect to another host or path.
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	return &S3Store{endpoint: endpoint, options: options, client: &client}, nil
}

// Put snapshots and hashes source before sending any network request. A 412
// only succeeds after verifying existing bytes; a successful upload is read back
// too. Conflicts and ambiguous network failures are returned for caller retries.
func (s *S3Store) Put(ctx context.Context, digest string, source io.ReadSeeker, size int64) error {
	if err := checkArtifactPut(ctx, digest, source, size); err != nil {
		return err
	}
	var snapshot bytes.Buffer
	snapshot.Grow(int(size))
	if err := copyArtifactSource(ctx, &snapshot, digest, source, size); err != nil {
		return err
	}
	hash, err := hex.DecodeString(digest)
	if err != nil {
		return fmt.Errorf("decode artifact digest: %w", err)
	}
	headers := make(http.Header)
	headers.Set("If-None-Match", "*")
	headers.Set("Content-Type", "application/octet-stream")
	headers.Set("X-Amz-Checksum-Sha256", base64.StdEncoding.EncodeToString(hash))
	response, err := s.request(ctx, http.MethodPut, digest, snapshot.Bytes(), headers)
	if err != nil {
		return err
	}
	status := response.StatusCode
	if err := drainArtifactS3Response(response); err != nil {
		return err
	}
	if status != http.StatusOK && status != http.StatusCreated && status != http.StatusNoContent && status != http.StatusPreconditionFailed {
		return fmt.Errorf("s3 put artifact returned http status %d", status)
	}
	contents, err := s.readArtifact(ctx, digest)
	if err != nil {
		return fmt.Errorf("verify s3 publication: %w", err)
	}
	if int64(len(contents)) != size {
		return fmt.Errorf("s3 publication size mismatch")
	}
	return nil
}

// Open downloads and verifies a bounded snapshot before returning a reader.
// No unverified network bytes are exposed to an artifact consumer.
func (s *S3Store) Open(ctx context.Context, digest string) (io.ReadCloser, error) {
	contents, err := s.readArtifact(ctx, digest)
	if err != nil {
		return nil, err
	}
	reader := io.NopCloser(bytes.NewReader(contents))
	return &artifactReadCloser{artifactContextReader: artifactContextReader{ctx: ctx, source: reader}, closer: reader}, nil
}

func (s *S3Store) request(ctx context.Context, method, digest string, body []byte, headers http.Header) (*http.Response, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	if s == nil || s.endpoint == nil || s.client == nil {
		return nil, fmt.Errorf("s3 artifact store is not initialized")
	}
	if !validArtifactDigest(digest) {
		return nil, fmt.Errorf("invalid artifact sha256 digest")
	}
	endpoint := *s.endpoint
	endpoint.Path += "/" + s.options.Bucket + "/"
	if s.options.Prefix != "" {
		endpoint.Path += s.options.Prefix + "/"
	}
	endpoint.Path += digest
	endpoint.RawPath = escapeArtifactS3Path(endpoint.Path)
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("create s3 artifact request: %w", err)
	}
	request.Header = headers.Clone()
	if request.Header == nil {
		request.Header = make(http.Header)
	}
	request.Header.Set("Accept-Encoding", "identity")
	s.sign(request, artifactSHA256(body), s.options.Clock())
	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("send s3 artifact request: %w", err)
	}
	return response, nil
}

func (s *S3Store) readArtifact(ctx context.Context, digest string) ([]byte, error) {
	response, err := s.request(ctx, http.MethodGet, digest, nil, nil)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, fmt.Errorf("s3 artifact: %w", os.ErrNotExist)
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("s3 get artifact returned http status %d", response.StatusCode)
	}
	if response.ContentLength == 0 || response.ContentLength > MaxArtifactBytes || response.Uncompressed ||
		(response.Header.Get("Content-Encoding") != "" && response.Header.Get("Content-Encoding") != "identity") {
		return nil, fmt.Errorf("invalid s3 artifact size or encoding")
	}
	contents, err := io.ReadAll(io.LimitReader(artifactContextReader{ctx: ctx, source: response.Body}, MaxArtifactBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read s3 artifact: %w", err)
	}
	if err := response.Body.Close(); err != nil {
		return nil, fmt.Errorf("close s3 artifact body: %w", err)
	}
	if len(contents) == 0 || len(contents) > MaxArtifactBytes || (response.ContentLength >= 0 && int64(len(contents)) != response.ContentLength) || artifactSHA256(contents) != digest {
		return nil, fmt.Errorf("s3 artifact size or sha256 mismatch")
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return contents, nil
}

func drainArtifactS3Response(response *http.Response) error {
	defer response.Body.Close()
	n, err := io.Copy(io.Discard, io.LimitReader(response.Body, (64<<10)+1))
	if err != nil {
		return fmt.Errorf("read s3 upload response: %w", err)
	}
	if n > 64<<10 {
		return fmt.Errorf("s3 upload response exceeds size limit")
	}
	if err := response.Body.Close(); err != nil {
		return fmt.Errorf("close s3 upload response: %w", err)
	}
	return nil
}
