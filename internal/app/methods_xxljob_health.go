package app

import (
	"context"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/xxljob"
)

// inspectXxlJobConnectionHealth reports the three stages a connection passes
// through: the login handshake, the detected protocol stack, and an
// authenticated executor listing that proves the session can read metadata.
//
// The client is opened isolated from the cache so a health probe never disturbs
// (or is disturbed by) the session a panel is using.
func (a *App) inspectXxlJobConnectionHealth(
	ctx context.Context,
	config connection.ConnectionConfig,
) []connection.ConnectionHealthCheck {
	config.Type = "xxljob"
	resolvedConfig, err := a.resolveConnectionSecrets(config)
	if err != nil {
		return healthChecksAfterConnectionFailure()
	}
	effectiveConfig := a.withManagedSSHHostKeyTrustStore(resolvedConfig)
	connectConfig, proxyErr := resolveDialConfigWithProxyFunc(effectiveConfig)
	if proxyErr != nil {
		return healthChecksAfterConnectionFailure()
	}
	connectConfig.Type = "xxljob"

	pingStartedAt := time.Now()
	client := xxljob.NewClient()
	info, connectErr := client.Connect(ctx, connectConfig)
	pingDuration := time.Since(pingStartedAt)
	if connectErr != nil {
		checks := []connection.ConnectionHealthCheck{
			failedHealthCheck(connection.ConnectionHealthCheckPing, pingDuration, "check_connection_settings"),
		}
		checks = append(checks, healthTLSCheck(config))
		return append(checks, healthChecksBlockedByPingFailure()...)
	}
	defer func() { _ = client.Close() }()

	version := passedHealthCheck(connection.ConnectionHealthCheckVersion, pingDuration, "")
	if family := info != nil && info.ProtocolFamily != "" && info.ProtocolFamily != "unknown"; family {
		version.Detail = info.ProtocolFamily
	} else {
		version = unsupportedHealthCheck(connection.ConnectionHealthCheckVersion, "not_available")
	}

	metadataContext, cancelMetadata := connectionHealthXxlJobOperationContext(ctx, config)
	defer cancelMetadata()
	metadataStartedAt := time.Now()
	_, listErr := client.NewProtocol().ListJobGroups(metadataContext, xxljob.GroupListRequest{Page: 1, Size: 1})
	permissions := passedHealthCheck(connection.ConnectionHealthCheckPermissions, time.Since(metadataStartedAt), "")
	if listErr != nil {
		permissions = failedHealthCheck(
			connection.ConnectionHealthCheckPermissions,
			time.Since(metadataStartedAt),
			"grant_metadata_read",
		)
	}

	return orderConnectionHealthChecks([]connection.ConnectionHealthCheck{
		passedHealthCheck(connection.ConnectionHealthCheckPing, pingDuration, ""),
		healthTLSCheck(config),
		version,
		permissions,
	})
}

func connectionHealthXxlJobOperationContext(
	ctx context.Context,
	config connection.ConnectionConfig,
) (context.Context, context.CancelFunc) {
	seconds := xxlJobOperationTimeoutSeconds(config)
	if seconds <= 0 {
		seconds = defaultXxlJobOperationTimeoutSeconds
	}
	return context.WithTimeout(ctx, time.Duration(seconds)*time.Second)
}
