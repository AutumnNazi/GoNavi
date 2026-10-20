// Package fontgallery manages opt-in, verified programming-font downloads.
package fontgallery

// DefaultBaseURL is the fixed production font-catalog origin.
// 字体文件仅由远程目录按需下载，不随安装包分发。
const DefaultBaseURL = "https://origin-download.syngnat.top:8443/gonavi/fonts/v1/"

// AssetURLPrefix is the same-origin, read-only installed font route.
const AssetURLPrefix = "/__gonavi/font-gallery/assets/"

// Catalog is a validated versioned font manifest. It never embeds font bytes.
type Catalog struct {
	SchemaVersion int     `json:"schemaVersion"`
	Version       string  `json:"version"`
	Entries       []Entry `json:"entries"`
}

// Entry describes one downloadable family. Preview is a separate, smaller asset.
type Entry struct {
	ID           string            `json:"id"`
	Version      string            `json:"version"`
	Kind         string            `json:"kind"`
	Family       string            `json:"family"`
	Names        map[string]string `json:"names"`
	Description  string            `json:"description"`
	UseCase      string            `json:"useCase"`
	Font         Asset             `json:"font"`
	Preview      Asset             `json:"preview"`
	Attribution  string            `json:"attribution"`
	SourceURL    string            `json:"sourceUrl"`
	RightsStatus string            `json:"rightsStatus"`
	License      License           `json:"license"`
}

// Asset is a content-addressed font or preview file.
type Asset struct {
	Path      string `json:"path"`
	SHA256    string `json:"sha256"`
	SizeBytes int64  `json:"sizeBytes"`
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

// Installed exposes a CSS family and relative resource URL, never a filesystem path.
type Installed struct {
	Entry  Entry  `json:"entry"`
	Family string `json:"family"`
	URL    string `json:"url"`
}

// Previewed is a verified on-demand preview that is not an installation.
type Previewed struct {
	Entry  Entry  `json:"entry"`
	Family string `json:"family"`
	URL    string `json:"url"`
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
