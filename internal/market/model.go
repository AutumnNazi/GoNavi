// Package market implements the shared, reviewed plugin marketplace.
package market

import (
	"encoding/json"
	"errors"
	"time"
)

// Artifact identifies immutable transport bytes, not the installed-content digest.
type Artifact struct {
	URL       string `json:"url"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"sizeBytes"`
	Platform  string `json:"platform"`
	Version   string `json:"version"`
}

// MarketPlugin is the public catalog representation of a published version.
type MarketPlugin struct {
	ID             string          `json:"id"`
	Name           string          `json:"name"`
	Description    string          `json:"description"`
	Author         string          `json:"author"`
	PublisherID    string          `json:"publisherId"`
	Official       bool            `json:"official"`
	Version        string          `json:"version"`
	Category       string          `json:"category,omitempty"`
	MinHostVersion string          `json:"minHostVersion,omitempty"`
	Platforms      []string        `json:"platforms"`
	RatingAverage  float64         `json:"ratingAverage"`
	RatingCount    int64           `json:"ratingCount"`
	DownloadCount  int64           `json:"downloadCount"`
	UpdatedAt      time.Time       `json:"updatedAt"`
	Manifest       json.RawMessage `json:"manifest,omitempty"`
	Artifact       *Artifact       `json:"artifact,omitempty"`
}

// CatalogPage is a bounded page. Cursors are opaque to clients.
type CatalogPage struct {
	Items      []MarketPlugin `json:"items"`
	NextCursor string         `json:"nextCursor,omitempty"`
}

// CatalogQuery contains validated public filters and a bounded offset.
type CatalogQuery struct {
	Query, Sort, HostVersion, Platform string
	Limit, Offset                      int
}

// Rating is the one mutable rating per authenticated user and plugin.
type Rating struct {
	UserID    string    `json:"userId"`
	PluginID  string    `json:"pluginId"`
	Stars     int       `json:"stars"`
	Body      string    `json:"body"`
	Version   string    `json:"version"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// Account contains service-assigned privileges, never claims from an OAuth client.
type Account struct {
	ID          string `json:"id"`
	Login       string `json:"login"`
	Role        string `json:"role"`
	PublisherID string `json:"publisherId,omitempty"`
	Official    bool   `json:"official"`
}

// Submission exposes the review state of one immutable package version.
type Submission struct {
	ID          string    `json:"id"`
	PluginID    string    `json:"pluginId"`
	Version     string    `json:"version"`
	State       string    `json:"state"`
	PublisherID string    `json:"publisherId"`
	Reason      string    `json:"reason,omitempty"`
	SHA256      string    `json:"sha256,omitempty"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

// ReviewDetail binds an administrator preview to the exact immutable package bytes.
type ReviewDetail struct {
	Submission Submission      `json:"submission"`
	Manifest   json.RawMessage `json:"manifest,omitempty"`
	Artifact   *Artifact       `json:"artifact,omitempty"`
}

// Audit records a privileged mutation; secrets and raw request bodies are excluded.
type Audit struct {
	ID        int64     `json:"id"`
	ActorID   string    `json:"actorId"`
	Action    string    `json:"action"`
	Subject   string    `json:"subject"`
	Reason    string    `json:"reason,omitempty"`
	CreatedAt time.Time `json:"createdAt"`
}

// Report is a bounded abuse report; handling is an administrator action.
type Report struct {
	PluginID string `json:"pluginId"`
	Reason   string `json:"reason"`
}

// ErrNotFound means the resource is absent or not publicly visible.
var ErrNotFound = errors.New("resource not found")

// ErrForbidden means the authenticated identity lacks permission.
var ErrForbidden = errors.New("operation forbidden")

// ErrConflict means an immutable identity or review transition already exists.
var ErrConflict = errors.New("resource conflict")

// ErrInvalid means a request or a state transition is invalid.
var ErrInvalid = errors.New("invalid request")

// ErrUnauthorized means the session is absent, expired or revoked.
var ErrUnauthorized = errors.New("authentication required")
