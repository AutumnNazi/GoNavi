// Package backgroundgallery manages opt-in, verified background downloads.
package backgroundgallery

// DefaultBaseURL is the fixed production gallery origin and namespace.
const DefaultBaseURL = "https://origin-download.syngnat.top:8443/gonavi/backgrounds/v1/"

// AssetURLPrefix is the same-origin, read-only installed asset route.
const AssetURLPrefix = "/__gonavi/background-gallery/assets/"

// Catalog is a validated versioned gallery manifest.
type Catalog struct {
	SchemaVersion int     `json:"schemaVersion"`
	Version       string  `json:"version"`
	Entries       []Entry `json:"entries"`
}

// Entry includes the complete offline attribution and license record.
type Entry struct {
	ID           string            `json:"id"`
	Version      string            `json:"version"`
	Names        map[string]string `json:"names"`
	Fit          string            `json:"fit"`
	Image        Asset             `json:"image"`
	Thumbnail    Asset             `json:"thumbnail"`
	Attribution  string            `json:"attribution"`
	SourceURL    string            `json:"sourceUrl"`
	RightsStatus string            `json:"rightsStatus"`
	License      License           `json:"license"`
}

// Asset describes an immutable static raster resource.
type Asset struct {
	Path      string `json:"path"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"sizeBytes"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
	MIMEType  string `json:"mimeType"`
}

// License preserves the publisher's rights record; it is not proof of ownership.
type License struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	URL           string `json:"url"`
	Notice        string `json:"notice"`
	Text          string `json:"text"`
	NonCommercial bool   `json:"nonCommercial"`
}

// Installed exposes a relative resource URL, never a filesystem path.
type Installed struct {
	Entry Entry  `json:"entry"`
	URL   string `json:"url"`
}

// State describes local state; a failed explicit refresh can return stale data.
type State struct {
	Catalog     *Catalog    `json:"catalog"`
	Installed   []Installed `json:"installed"`
	Stale       bool        `json:"stale"`
	WarningCode string      `json:"warningCode,omitempty"`
}

// Progress is synchronous download progress; the App supplies RequestID.
type Progress struct {
	RequestID  string `json:"requestId"`
	Downloaded int64  `json:"downloaded"`
	Total      int64  `json:"total"`
	Phase      string `json:"phase"`
}
