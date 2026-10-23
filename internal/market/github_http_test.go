package market

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type githubRoundTripFunc func(*http.Request) (*http.Response, error)

func (f githubRoundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return f(req)
}

type githubTrackingBody struct {
	io.ReadCloser
	readBytes *atomic.Int64
	closes    *atomic.Int32
}

func (b *githubTrackingBody) Read(buffer []byte) (int, error) {
	n, err := b.ReadCloser.Read(buffer)
	b.readBytes.Add(int64(n))
	return n, err
}

func (b *githubTrackingBody) Close() error {
	b.closes.Add(1)
	return b.ReadCloser.Close()
}

func TestGitHubExchangeRejectsRedirects(t *testing.T) {
	for _, stage := range []string{"token", "identity"} {
		for _, crossOrigin := range []bool{false, true} {
			for _, status := range []int{301, 302, 303, 307, 308} {
				name := stage + "/crossOrigin=" + strconv.FormatBool(crossOrigin) + "/" + strconv.Itoa(status)
				t.Run(name, func(t *testing.T) {
					var leakedRequests, customRedirectCalls atomic.Int32
					sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
						leakedRequests.Add(1)
						writeGitHubTestResponse(t, w, http.StatusOK, githubTestIdentityJSON)
					}))
					t.Cleanup(sink.Close)
					target := "/sink?private-redirect-marker"
					if crossOrigin {
						target = sink.URL + target
					}
					provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
						if r.URL.Path == "/sink" {
							leakedRequests.Add(1)
							return
						}
						if r.URL.Path == "/token" && stage == "identity" {
							writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
							return
						}
						http.Redirect(w, r, target, status)
					})
					provider.httpClient = githubHTTPClient(&http.Client{CheckRedirect: func(*http.Request, []*http.Request) error {
						customRedirectCalls.Add(1)
						return nil
					}})
					identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
					assertGitHubFailure(t, identity, err, "private-redirect-marker")
					if leakedRequests.Load() != 0 || customRedirectCalls.Load() != 0 {
						t.Fatal("redirect forwarded a request or delegated to an unsafe policy")
					}
				})
			}
		}
	}
}

func TestGitHubExchangeCookieIsolation(t *testing.T) {
	var calls atomic.Int32
	provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.Header.Get("Cookie") != "" {
			t.Error("shared cookies reached GitHub")
		}
		w.Header().Set("Set-Cookie", "new-session=private-cookie; Path=/")
		body := githubTestTokenJSON
		if r.URL.Path == "/user" {
			body = githubTestIdentityJSON
		}
		writeGitHubTestResponse(t, w, http.StatusOK, body)
	})
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(provider.tokenURL)
	if err != nil {
		t.Fatal(err)
	}
	jar.SetCookies(u, []*http.Cookie{{Name: "old-session", Value: "private-cookie", Path: "/"}})
	source := &http.Client{Jar: jar}
	provider.httpClient = githubHTTPClient(source)
	if _, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || source.Jar != jar || len(jar.Cookies(u)) != 1 || jar.Cookies(u)[0].Name != "old-session" {
		t.Fatal("exchange must neither use nor modify the source cookie jar")
	}
}

func TestGitHubExchangeInvalidInputs(t *testing.T) {
	var calls atomic.Int32
	provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	})
	for _, tt := range []struct {
		name     string
		ctx      context.Context
		code     string
		verifier string
	}{
		{name: "nil context", code: githubTestCode, verifier: githubTestVerifier},
		{name: "empty code", ctx: context.Background(), verifier: githubTestVerifier},
		{name: "blank code", ctx: context.Background(), code: " \t", verifier: githubTestVerifier},
		{name: "empty verifier", ctx: context.Background(), code: githubTestCode},
		{name: "blank verifier", ctx: context.Background(), code: githubTestCode, verifier: " \t"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			identity, err := provider.Exchange(tt.ctx, tt.code, tt.verifier)
			assertGitHubFailure(t, identity, err)
		})
	}
	if calls.Load() != 0 {
		t.Fatal("invalid inputs made HTTP requests")
	}
}

func TestGitHubProviderUninitialized(t *testing.T) {
	for _, provider := range []*GitHubProvider{nil, {}} {
		if provider.AuthorizeURL("state", githubTestChallenge) != "" {
			t.Fatal("uninitialized provider generated an authorization URL")
		}
		identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
		assertGitHubFailure(t, identity, err)
	}
}

func TestGitHubExchangeInvalidEndpoints(t *testing.T) {
	for _, stage := range []string{"token", "identity"} {
		for _, endpoint := range []string{"://private-endpoint-marker", "ftp://example.test/private-endpoint-marker"} {
			t.Run(stage+"/"+endpoint, func(t *testing.T) {
				provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
					writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
				})
				if stage == "token" {
					provider.tokenURL = endpoint
				} else {
					provider.userURL = endpoint
				}
				identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
				assertGitHubFailure(t, identity, err, "private-endpoint-marker")
			})
		}
	}
}

func TestGitHubExchangeTransportErrorRedaction(t *testing.T) {
	for _, stage := range []string{"token", "identity"} {
		for _, cause := range []error{nil, context.Canceled, context.DeadlineExceeded} {
			t.Run(fmt.Sprintf("%s/%v", stage, cause), func(t *testing.T) {
				provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
					writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
				})
				transport := provider.httpClient.Transport
				provider.httpClient.Transport = githubRoundTripFunc(func(req *http.Request) (*http.Response, error) {
					if req.URL.Path == "/token" && stage == "identity" {
						return transport.RoundTrip(req)
					}
					if cause != nil {
						return nil, fmt.Errorf("private-transport-marker %s: %w", githubTestClientSecret, cause)
					}
					return nil, errors.New("private-transport-marker " + githubTestToken)
				})
				identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
				assertGitHubFailure(t, identity, err, "private-transport-marker")
				if cause != nil && !errors.Is(err, cause) {
					t.Fatalf("lost canonical context cause: %v", err)
				}
			})
		}
	}
}

func githubStallingProvider(t *testing.T, stage string, body bool) (*GitHubProvider, <-chan struct{}) {
	t.Helper()
	started, release := make(chan struct{}), make(chan struct{})
	provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/token" && stage == "identity" {
			writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
			return
		}
		if body {
			if _, err := w.Write([]byte("{")); err != nil {
				t.Errorf("write partial response: %v", err)
				return
			}
			w.(http.Flusher).Flush()
		}
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	})
	// Unblock the server before its cleanup even when a cancellation assertion fails.
	t.Cleanup(func() { close(release) })
	return provider, started
}

func TestGitHubExchangeCanceledContext(t *testing.T) {
	provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		t.Error("already canceled context reached the server")
		w.WriteHeader(http.StatusInternalServerError)
	})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	identity, err := provider.Exchange(ctx, githubTestCode, githubTestVerifier)
	assertGitHubFailure(t, identity, err)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("lost cancellation: %v", err)
	}
}

func TestGitHubExchangeCancellation(t *testing.T) {
	for _, stage := range []string{"token", "identity"} {
		for _, body := range []bool{false, true} {
			t.Run(stage+"/body="+strconv.FormatBool(body), func(t *testing.T) {
				provider, started := githubStallingProvider(t, stage, body)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				type result struct {
					identity Identity
					err      error
				}
				// One result must not block the worker if the test exits on its watchdog.
				completed := make(chan result, 1)
				go func() {
					identity, err := provider.Exchange(ctx, githubTestCode, githubTestVerifier)
					completed <- result{identity: identity, err: err}
				}()
				select {
				case <-started:
				case <-time.After(3 * time.Second):
					t.Fatal("request did not reach the stalling handler")
				}
				cancel()
				select {
				case result := <-completed:
					assertGitHubFailure(t, result.identity, result.err)
					if !errors.Is(result.err, context.Canceled) {
						t.Fatalf("lost cancellation: %v", result.err)
					}
				case <-time.After(3 * time.Second):
					t.Fatal("exchange ignored cancellation")
				}
			})
		}
	}
}

func TestGitHubExchangeTimeout(t *testing.T) {
	for _, stage := range []string{"token", "identity"} {
		for _, body := range []bool{false, true} {
			for _, callerDeadline := range []bool{false, true} {
				name := stage + "/body=" + strconv.FormatBool(body) + "/callerDeadline=" + strconv.FormatBool(callerDeadline)
				t.Run(name, func(t *testing.T) {
					provider, started := githubStallingProvider(t, stage, body)
					ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
					defer cancel()
					if callerDeadline {
						var deadlineCancel context.CancelFunc
						ctx, deadlineCancel = context.WithTimeout(ctx, 100*time.Millisecond)
						defer deadlineCancel()
					} else {
						provider.httpClient.Timeout = 100 * time.Millisecond
					}
					start := time.Now()
					identity, err := provider.Exchange(ctx, githubTestCode, githubTestVerifier)
					assertGitHubFailure(t, identity, err)
					if !errors.Is(err, context.DeadlineExceeded) || time.Since(start) > 2*time.Second {
						t.Fatalf("exchange did not honor finite timeout: %v", err)
					}
					select {
					case <-started:
					default:
						t.Fatal("test did not reach the stalling handler")
					}
				})
			}
		}
	}
}

func TestGitHubExchangeSharesDeadline(t *testing.T) {
	provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		body := githubTestTokenJSON
		if r.URL.Path == "/user" {
			body = githubTestIdentityJSON
		}
		writeGitHubTestResponse(t, w, http.StatusOK, body)
	})
	var deadlines []time.Time
	transport := provider.httpClient.Transport
	provider.httpClient.Transport = githubRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		deadline, ok := req.Context().Deadline()
		if !ok {
			t.Error("request has no finite deadline")
		}
		deadlines = append(deadlines, deadline)
		return transport.RoundTrip(req)
	})
	if _, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier); err != nil {
		t.Fatal(err)
	}
	if len(deadlines) != 2 || !deadlines[0].Equal(deadlines[1]) || time.Until(deadlines[0]) > githubHTTPTimeout {
		t.Fatalf("requests must share one exchange deadline: %v", deadlines)
	}
}

func TestGitHubValidToken(t *testing.T) {
	for _, tt := range []struct {
		token string
		valid bool
	}{
		{token: "aZ09-._~+/==", valid: true},
		{token: githubTestToken, valid: true},
		{token: ""}, {token: "="}, {token: "abc=def"}, {token: "abc def"},
		{token: "abc\r\n"}, {token: "abc\x7f"}, {token: "abc\u00e9"}, {token: "abc:123"},
	} {
		t.Run(strconv.Quote(tt.token), func(t *testing.T) {
			if valid := githubValidToken(tt.token); valid != tt.valid {
				t.Fatalf("token validation=%v, want %v", valid, tt.valid)
			}
		})
	}
}

func TestGitHubExchangeReadErrorRedaction(t *testing.T) {
	provider := newGitHubTestProvider(t, func(w http.ResponseWriter, r *http.Request) {
		writeGitHubTestResponse(t, w, http.StatusOK, githubTestTokenJSON)
	})
	transport := provider.httpClient.Transport
	var closes atomic.Int32
	provider.httpClient.Transport = githubRoundTripFunc(func(req *http.Request) (*http.Response, error) {
		response, err := transport.RoundTrip(req)
		if err != nil {
			return nil, err
		}
		response.Body = &githubErrorBody{ReadCloser: response.Body, closes: &closes}
		return response, nil
	})
	identity, err := provider.Exchange(context.Background(), githubTestCode, githubTestVerifier)
	assertGitHubFailure(t, identity, err, "private-read-marker")
	if closes.Load() != 1 || strings.Contains(err.Error(), "private-read-marker") {
		t.Fatal("failed response body must be closed with its error redacted")
	}
}

type githubErrorBody struct {
	io.ReadCloser
	closes *atomic.Int32
}

func (b *githubErrorBody) Read([]byte) (int, error) {
	return 0, errors.New("private-read-marker " + githubTestToken)
}

func (b *githubErrorBody) Close() error {
	b.closes.Add(1)
	return b.ReadCloser.Close()
}
