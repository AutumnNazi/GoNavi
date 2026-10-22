package provider

import "errors"

// ErrPluginProviderConfig rejects unsupported or malformed selected configuration.
var ErrPluginProviderConfig = errors.New("plugin provider configuration rejected")

// ErrPluginProviderUnavailable rejects missing, revoked or changed execution authority.
var ErrPluginProviderUnavailable = errors.New("plugin provider unavailable")

// ErrPluginProviderResponse rejects an incomplete or invalid completion without replay.
var ErrPluginProviderResponse = errors.New("plugin provider response rejected")

// ErrPluginProviderOperation intentionally has no network/process cause or upstream text.
// A dispatched generation has unknown outcome on failure and must never be replayed.
var ErrPluginProviderOperation = errors.New("plugin provider operation failed")

// ErrPluginProviderLimit reports a bounded completion/resource admission failure.
var ErrPluginProviderLimit = errors.New("plugin provider limit exceeded")
