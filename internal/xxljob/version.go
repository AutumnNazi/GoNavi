package xxljob

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

// pageProbe distinguishes the two page shells without relying on which request
// parameters the admin happens to accept. Probing with the legacy parameters and
// inspecting the response shape is reliable because every version answers with a
// structure its own front end understands, whereas unknown parameters are simply
// ignored and would make parameter-based probing guess wrong.
type pageProbe struct {
	RecordsTotal *int              `json:"recordsTotal"`
	Total        *int              `json:"total"`
	Rows         []json.RawMessage `json:"data"`
}

// rowProbe distinguishes the pre-3.5.0 and post-3.5.0 field names.
type rowProbe struct {
	Name  *string `json:"name"`
	Title *string `json:"title"`
}

// DetectLoginFamily resolves the authentication family from the redirect the
// admin issues for an unauthenticated root request. The Location keeps the
// context-path, so only the path suffix is compared. An unrecognized answer
// returns an empty family and no error, leaving performLogin to try both
// families against the live endpoints.
func (c *Client) DetectLoginFamily(ctx context.Context) (LoginFamily, string, error) {
	requestCtx, cancel := c.requestTimeout(ctx)
	defer cancel()
	raw, err := c.do(requestCtx, http.MethodGet, "/", nil, nil)
	if err != nil {
		return "", "", err
	}
	if !isRedirectStatus(raw.status) {
		return "", "", nil
	}
	location := strings.ToLower(strings.TrimSpace(raw.location))
	switch {
	case strings.HasSuffix(location, strings.ToLower(route3LoginPage)):
		return LoginSSO, raw.location, nil
	case strings.HasSuffix(location, strings.ToLower(route2LoginPage)):
		return LoginLegacy, raw.location, nil
	default:
		return "", raw.location, nil
	}
}

// DetectPagingAndFields resolves the paging family and the field era from a
// single authenticated executor listing. An unrecognized payload falls back to
// the 2.x shape rather than failing the connection.
func (c *Client) DetectPagingAndFields(ctx context.Context) (PaginationFamily, FieldEra, error) {
	values := url.Values{}
	values.Set("start", "0")
	values.Set("length", "1")
	// 3.0-3.2.x bind appname and title as required request parameters on the
	// group paging route and answer a request without them with HTTP 400.
	// Sending the empty filters keeps the probe valid on every version:
	// the admins that treat them as optional ignore the empty values.
	values.Set("appname", "")
	values.Set("title", "")

	requestCtx, cancel := c.requestTimeout(ctx)
	defer cancel()
	raw, err := c.do(requestCtx, http.MethodPost, routeJobGroupPageList, values, nil)
	if err != nil {
		return "", "", err
	}
	if raw.status != http.StatusOK {
		return "", "", &HTTPStatusError{Status: raw.status, Body: string(raw.body)}
	}
	envelope, decodeErr := decodeEnvelope(raw.body)
	if decodeErr != nil {
		return "", "", localizedXxlJobErrorWithCause("xxljob.backend.error.invalid_response", nil, decodeErr)
	}
	if !envelope.succeeded() {
		return "", "", remoteError(envelope.code(), envelope.text())
	}

	pagination, fields := classifyPagePayload(envelope.pagePayload())
	return pagination, fields, nil
}

// classifyPagePayload maps one page payload onto the two version axes.
func classifyPagePayload(payload []byte) (PaginationFamily, FieldEra) {
	probe, ok := probePage(payload)
	if !ok {
		return PageStartLength, FieldLegacy
	}
	pagination := PageStartLength
	switch {
	case probe.RecordsTotal != nil:
		pagination = PageStartLength
	case probe.Total != nil:
		pagination = PageOffsetPageSize
	}
	return pagination, classifyFieldEra(probe)
}

func probePage(payload []byte) (pageProbe, bool) {
	var probe pageProbe
	if !isPresentPayload(payload) {
		return probe, false
	}
	if err := json.Unmarshal(payload, &probe); err != nil {
		return probe, false
	}
	return probe, true
}

// classifyFieldEra treats a row as renamed only when it carries "name" and no
// "title". With no rows there is nothing to inspect, so the pre-3.5.0 names are
// assumed, which keeps the majority of deployments working.
func classifyFieldEra(probe pageProbe) FieldEra {
	if len(probe.Rows) == 0 {
		return FieldLegacy
	}
	var row rowProbe
	if err := json.Unmarshal(probe.Rows[0], &row); err != nil {
		return FieldLegacy
	}
	if row.Name != nil && row.Title == nil {
		return FieldRenamed
	}
	return FieldLegacy
}
