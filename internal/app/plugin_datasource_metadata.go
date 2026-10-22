package app

import "strings"

// Plugin metadata remains uncached in this first slice. A connection-generation
// cache key alone cannot fence the separate, shared metadata-result cache. Every
// read must reach the adapter's live generation check; do not coalesce it with an
// earlier session or publish returned rows into the builtin TTL cache.
const pluginMetadataUncachedPrefix = "\x00plugin-datasource-uncached\x00"

func isPluginMetadataUncachedKey(key string) bool {
	return strings.HasPrefix(key, pluginMetadataUncachedPrefix)
}
