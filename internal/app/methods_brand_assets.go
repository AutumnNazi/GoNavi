package app

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const (
	brandAssetRemoteBaseURL = "https://origin-download.syngnat.top:8443/gonavi/brand-assets/v1"
	brandAssetCacheDirName  = "brand-icons"
	brandAssetMaxBytes      = 4 << 20
)

type brandAssetDefinition struct {
	ID       string
	FileName string
	SHA256   string
}

var brandAssetDefinitions = map[string]brandAssetDefinition{
	"01": {ID: "01", FileName: "01-ribbon-graphite-air.svg", SHA256: "3cab076e113e1722ae6f1dce9f295f3a1d404e4cfb11e76944452e149fcc7b04"},
	"02": {ID: "02", FileName: "02-ribbon-graphite.svg", SHA256: "c1185639143e0212cdb9b4895c57cca5160d722d56afccffbe523994cd353a2e"},
	"03": {ID: "03", FileName: "03-ribbon-graphite-glow.svg", SHA256: "a85f15c0dbe753ac2df2143c1048f0cdc9fa1174ecf2ae8b66e47762ef3659ee"},
	"04": {ID: "04", FileName: "04-ribbon-indigo-light.svg", SHA256: "b040d0b9597cf46e6d16c7a10b876c59126d4cdfcc14b8016c88ac9ccd12cca7"},
	"05": {ID: "05", FileName: "05-ribbon-graphite-light.svg", SHA256: "d8a726f229d9aed116545a361667928979baaf530b181986ed76fe655cb7fd9f"},
	"06": {ID: "06", FileName: "06-ribbon-lilac-dark.svg", SHA256: "f5d11c757a337470a4126e6641eedbd3912eb8932d5000b2dc2d363a409cb4fc"},
	// 0.9.7 吉祥物（07–16）不再随安装包内嵌：选择器预览图（webp）、关于页大图（-about）
	// 与 08 的透明标题栏标识（-titlebar）按需下载并缓存，省下约 2.5 MB 安装体积。
	"07":          {ID: "07", FileName: "07-database-hug.webp", SHA256: "4c129387e1075eecc4e4866b00c3b597f3c5b2fe3099669fe529792ba306c2d4"},
	"07-about":    {ID: "07-about", FileName: "07-database-hug-about.png", SHA256: "b13f20d53c4e109dccc151d2d23e2b67c0e7d2760befc117694d2414b3c4da5e"},
	"08":          {ID: "08", FileName: "08-database-search.webp", SHA256: "7783d8998339a8fa534e6f7153a3b1613fe35d79b64afe22970664e46d7ecc1f"},
	"08-about":    {ID: "08-about", FileName: "08-database-search-about.png", SHA256: "07ed05009c87fca6aa77394647be11d5d937403f8e92882ac749c7895f6208a6"},
	"08-titlebar": {ID: "08-titlebar", FileName: "08-database-search-transparent.png", SHA256: "add7dd233b22beb9cbb1a801f7f90d95fa27413594cf76c7ccfb1f08c333c5d9"},
	"09":          {ID: "09", FileName: "09-bandana-badge.webp", SHA256: "470c2176438f523403ad6561b6e239eee7206a1d878311fe132928ef8346ba7d"},
	"09-about":    {ID: "09-about", FileName: "09-bandana-badge-about.png", SHA256: "627834b1c1f148885c3227fc38ffab233b065c813e3a452b8f761a9bb998f570"},
	"10":          {ID: "10", FileName: "10-magnifier-wink.webp", SHA256: "f2941dfb03e53390280851e939a470717a888d9c7f253f656a0e01b6b7efe63c"},
	"10-about":    {ID: "10-about", FileName: "10-magnifier-wink-about.png", SHA256: "2b5d570c50704f2fc447196e71500fd96020e54558743582674197a7d63cab8e"},
	"11":          {ID: "11", FileName: "11-window-peek.webp", SHA256: "cb0ffd85a4bebe18508b5ef847b9890d0d21b4d9d18a8ad3b7fdac1d934c418e"},
	"11-about":    {ID: "11-about", FileName: "11-window-peek-about.png", SHA256: "87cd3128a8d2da3534c293eec3f099bf7858e6277e261fadaf1ab7d40fa58b99"},
	"12":          {ID: "12", FileName: "12-hex-collar.webp", SHA256: "9f703a1c7bdfcb74f480221ac6be243432831d3b4646d7bf4ad8ead0162d489d"},
	"12-about":    {ID: "12-about", FileName: "12-hex-collar-about.png", SHA256: "b6bb206276a33f069fd97059160a842d586412dd8a1f051000653e68a0571f0d"},
	"13":          {ID: "13", FileName: "13-graph-sit.webp", SHA256: "5468659ea588333ed730ca57942f514b45001c7e4e25e062cf21556e20ed586c"},
	"13-about":    {ID: "13-about", FileName: "13-graph-sit-about.png", SHA256: "ca103f81028ff593636c99a45a8b922edf596892f42b380a265354c9ea4a5442"},
	"14":          {ID: "14", FileName: "14-cloud-banner.webp", SHA256: "95a0d28ac87ca75f04c3c6e28d9b08b2537d8dea4883a64dba541103f02d7b35"},
	"14-about":    {ID: "14-about", FileName: "14-cloud-banner-about.png", SHA256: "0d8d31eceb3937732c81d59189c88e698b57fe0a87eadbb7be607466b234b721"},
	"15":          {ID: "15", FileName: "15-terminal-sit.webp", SHA256: "4568644f6481736563c1b6cb80b27c68d259c9925f6c7df48979a07a39e01b54"},
	"15-about":    {ID: "15-about", FileName: "15-terminal-sit-about.png", SHA256: "6f23a3eb400ea3bba3be1810e45920f8bb828da3b6c1845e3614b28b7bc29c52"},
	"16":          {ID: "16", FileName: "16-compass-bandana.webp", SHA256: "d9052513e483471059e170c2606ca92a5facfcafcc252562cc58c1de680ac869"},
	"16-about":    {ID: "16-about", FileName: "16-compass-bandana-about.png", SHA256: "60a06e05d670e1baba5ada4540fd28d412dd7fc4d94a58bcde157f77f7133867"},
}

var brandAssetHTTPClient = &http.Client{Timeout: 30 * time.Second}
var brandAssetRemoteBaseURLForTests = ""
var brandAssetMu sync.Mutex

var (
	errBrandAssetUnknownID = errors.New("unknown brand asset id")
	errBrandAssetInvalid   = errors.New("invalid brand asset")
)

// GetBrandIconDataURL returns a verified brand asset (SVG / WebP / PNG) from the
// application cache. id is a brand asset key such as "02", "07-about" or
// "08-titlebar". A missing asset is downloaded once from the immutable Bero
// origin and then served locally on subsequent starts.
func (a *App) GetBrandIconDataURL(id string) (string, error) {
	brandAssetMu.Lock()
	defer brandAssetMu.Unlock()
	definition, ok := brandAssetDefinitions[strings.TrimSpace(id)]
	if !ok {
		return "", errBrandAssetUnknownID
	}
	cacheDir := strings.TrimSpace(a.configDir)
	if cacheDir == "" {
		cacheDir = resolveAppConfigDir()
	}
	assetDir := filepath.Join(cacheDir, brandAssetCacheDirName, "v1")
	assetPath := filepath.Join(assetDir, definition.FileName)
	if data, err := readVerifiedBrandAsset(assetPath, definition.SHA256); err == nil {
		return brandAssetDataURL(definition.FileName, data), nil
	}

	if err := os.MkdirAll(assetDir, 0o755); err != nil {
		return "", fmt.Errorf("create brand asset cache: %w", err)
	}
	baseURL := brandAssetRemoteBaseURL
	if strings.TrimSpace(brandAssetRemoteBaseURLForTests) != "" {
		baseURL = strings.TrimRight(brandAssetRemoteBaseURLForTests, "/")
	}
	request, err := http.NewRequest(http.MethodGet, baseURL+"/"+definition.FileName, nil)
	if err != nil {
		return "", fmt.Errorf("build brand asset request: %w", err)
	}
	response, err := brandAssetHTTPClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("download brand asset: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download brand asset: unexpected HTTP status %s", response.Status)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, brandAssetMaxBytes+1))
	if err != nil {
		return "", fmt.Errorf("read brand asset: %w", err)
	}
	if len(data) > brandAssetMaxBytes {
		return "", fmt.Errorf("%w: size exceeds %d bytes", errBrandAssetInvalid, brandAssetMaxBytes)
	}
	if !brandAssetHashMatches(data, definition.SHA256) {
		return "", fmt.Errorf("%w: sha256 mismatch", errBrandAssetInvalid)
	}
	temporary, err := os.CreateTemp(assetDir, ".brand-asset-*.tmp")
	if err != nil {
		return "", fmt.Errorf("create brand asset temp file: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(data); err != nil {
		temporary.Close()
		return "", fmt.Errorf("write brand asset cache: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return "", fmt.Errorf("close brand asset cache: %w", err)
	}
	if err := os.Rename(temporaryPath, assetPath); err != nil {
		return "", fmt.Errorf("commit brand asset cache: %w", err)
	}
	return brandAssetDataURL(definition.FileName, data), nil
}

func readVerifiedBrandAsset(path string, expectedSHA256 string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(data) > brandAssetMaxBytes || !brandAssetHashMatches(data, expectedSHA256) {
		return nil, errBrandAssetInvalid
	}
	return data, nil
}

func brandAssetHashMatches(data []byte, expectedSHA256 string) bool {
	hash := sha256.Sum256(data)
	return strings.EqualFold(hex.EncodeToString(hash[:]), expectedSHA256)
}

func brandAssetDataURL(fileName string, data []byte) string {
	mimeType := "image/svg+xml"
	switch strings.ToLower(filepath.Ext(fileName)) {
	case ".webp":
		mimeType = "image/webp"
	case ".png":
		mimeType = "image/png"
	}
	return "data:" + mimeType + ";base64," + base64.StdEncoding.EncodeToString(data)
}
