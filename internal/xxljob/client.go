package xxljob

import (
	"context"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"golang.org/x/sync/singleflight"
)

const (
	defaultXxlJobPort    = 8080
	defaultXxlJobTimeout = 30 * time.Second
	maxResponseBytes     = 16 << 20
	maxPageSize          = 200
	defaultPageSize      = 20
	xxlJobUserAgent      = "GoNavi/xxljob"
)

// rawResponse is the transport-level view of one admin call, before any
// envelope decoding. Location is populated only when redirects are suppressed,
// which is how a 2.x expired session is detected.
type rawResponse struct {
	body     []byte
	status   int
	location string
}

// Client is a session-scoped XXL-JOB admin client. Cookies live only in the
// in-memory jar for the lifetime of the client and are never persisted.
type Client struct {
	mu         sync.Mutex
	config     connection.ConnectionConfig
	httpClient *http.Client
	jar        *cookiejar.Jar
	baseURL    *url.URL
	stack      Stack
	loggedIn   bool
	forwarder  forwarderLease
	loginGroup *singleflight.Group
	acquire    acquireForwarderFunc
}

// NewClient returns a client that is not yet connected.
func NewClient() *Client {
	return &Client{acquire: acquireXxlJobForwarder}
}

// ConnectInfo is what the app binding surfaces after a successful connect.
type ConnectInfo struct {
	ProtocolFamily   string `json:"protocolFamily"`
	LoginFamily      string `json:"loginFamily"`
	PaginationFamily string `json:"paginationFamily"`
	FieldEra         string `json:"fieldEra"`
	LoginRedirect    string `json:"loginRedirect,omitempty"`
}

// Connect normalizes the configuration, prepares the transport, detects the
// protocol stack, and logs in. Any failure leaves the client closed.
func (c *Client) Connect(ctx context.Context, config connection.ConnectionConfig) (*ConnectInfo, error) {
	if ctx == nil {
		return nil, newValidationError("ctx", "nil context")
	}
	normalized, err := normalizeXxlJobConfig(config)
	if err != nil {
		return nil, err
	}
	if _, hasDeadline := ctx.Deadline(); !hasDeadline {
		var cancel context.CancelFunc
		ctx, cancel = context.WithTimeout(ctx, time.Duration(normalized.Timeout)*time.Second)
		defer cancel()
	}
	if err := c.Close(); err != nil {
		return nil, err
	}

	dialAddress, forwarder, err := c.resolveDialTarget(ctx, normalized)
	if err != nil {
		return nil, err
	}

	httpClient, baseURL, jar, err := buildXxlJobHTTPClient(normalized, dialAddress)
	if err != nil {
		releaseForwarder(forwarder)
		return nil, err
	}

	c.mu.Lock()
	c.config = normalized
	c.httpClient = httpClient
	c.baseURL = baseURL
	c.jar = jar
	c.forwarder = forwarder
	c.loggedIn = false
	c.loginGroup = &singleflight.Group{}
	c.mu.Unlock()

	// Resolve the authentication family first: the unauthenticated root
	// redirect names the login route, and performLogin can still fall back to
	// trying both when the redirect is customized or absent.
	c.mu.Lock()
	c.stack = legacyStack()
	c.mu.Unlock()

	family, location, probeErr := c.DetectLoginFamily(ctx)
	if probeErr != nil {
		_ = c.Close()
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, probeErr
	}
	if family != "" {
		c.mu.Lock()
		c.stack.Login = family
		c.mu.Unlock()
	}

	if err := c.ensureLoggedIn(ctx); err != nil {
		_ = c.Close()
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, err
	}

	pagination, fields, probeErr := c.DetectPagingAndFields(ctx)
	if probeErr != nil {
		_ = c.Close()
		if ctxErr := ctx.Err(); ctxErr != nil {
			return nil, ctxErr
		}
		return nil, probeErr
	}
	c.mu.Lock()
	c.stack.Pagination = pagination
	c.stack.Fields = fields
	stack := c.stack
	c.mu.Unlock()

	return &ConnectInfo{
		ProtocolFamily:   stack.FamilyLabel(),
		LoginFamily:      string(stack.Login),
		PaginationFamily: string(stack.Pagination),
		FieldEra:         string(stack.Fields),
		LoginRedirect:    location,
	}, nil
}

// Close releases the transport and the SSH forwarder if one was opened.
func (c *Client) Close() error {
	c.mu.Lock()
	httpClient := c.httpClient
	forwarder := c.forwarder
	c.config = connection.ConnectionConfig{}
	c.httpClient = nil
	c.jar = nil
	c.baseURL = nil
	c.stack = Stack{}
	c.loggedIn = false
	c.forwarder = nil
	c.loginGroup = nil
	c.mu.Unlock()

	releaseForwarder(forwarder)
	if httpClient != nil {
		httpClient.CloseIdleConnections()
	}
	return nil
}

func normalizeXxlJobConfig(config connection.ConnectionConfig) (connection.ConnectionConfig, error) {
	run := config
	run.Type = "xxljob"
	run.Host = strings.TrimSpace(run.Host)
	if run.Host == "" {
		return run, newValidationError("host", "host is required")
	}
	if run.Port <= 0 {
		run.Port = defaultXxlJobPort
	}
	if run.Timeout <= 0 {
		run.Timeout = int(defaultXxlJobTimeout / time.Second)
	}
	return run, nil
}

// do performs exactly one authenticated transport attempt. It never retries, so
// callers can decide how to handle an expired session.
func (c *Client) do(
	ctx context.Context,
	method string,
	apiPath string,
	form url.Values,
	query url.Values,
) (rawResponse, error) {
	c.mu.Lock()
	httpClient := c.httpClient
	base := c.baseURL
	c.mu.Unlock()
	if httpClient == nil || base == nil {
		return rawResponse{}, localizedXxlJobError("xxljob.backend.error.not_connected", nil)
	}
	if err := ctx.Err(); err != nil {
		return rawResponse{}, err
	}

	endpoint := *base
	endpoint.Path = base.Path + apiPath
	if query != nil {
		endpoint.RawQuery = query.Encode()
	}

	var bodyReader io.Reader
	contentType := ""
	if form != nil {
		bodyReader = strings.NewReader(form.Encode())
		contentType = "application/x-www-form-urlencoded"
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bodyReader)
	if err != nil {
		return rawResponse{}, localizedXxlJobErrorWithCause("xxljob.backend.error.request_build_failed", nil, err)
	}
	request.Header.Set("User-Agent", xxlJobUserAgent)
	request.Header.Set("Accept", "application/json, text/plain, */*")
	request.Header.Set("X-Requested-With", "XMLHttpRequest")
	if contentType != "" {
		request.Header.Set("Content-Type", contentType)
	}

	response, err := httpClient.Do(request)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return rawResponse{}, ctxErr
		}
		return rawResponse{}, wrapNetworkError(err)
	}
	defer response.Body.Close()

	payload, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return rawResponse{}, localizedXxlJobErrorWithCause("xxljob.backend.error.read_body_failed", nil, err)
	}
	return rawResponse{
		body:     payload,
		status:   response.StatusCode,
		location: response.Header.Get("Location"),
	}, nil
}

// requestTimeout derives the per-request deadline from QueryTimeout so a slow
// admin cannot hold a UI call open indefinitely.
func (c *Client) requestTimeout(ctx context.Context) (context.Context, context.CancelFunc) {
	c.mu.Lock()
	queryTimeout := c.config.QueryTimeout
	c.mu.Unlock()
	if queryTimeout <= 0 {
		return context.WithCancel(ctx)
	}
	return context.WithTimeout(ctx, time.Duration(queryTimeout)*time.Second)
}

func (c *Client) stackSnapshot() Stack {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stack
}

// ProtocolFamily reports the detected stack, e.g. "2.x" or "3.3+".
func (c *Client) ProtocolFamily() string {
	return c.stackSnapshot().FamilyLabel()
}

// Connected reports whether the client currently holds a usable session.
func (c *Client) Connected() bool { return c.isLoggedIn() }
