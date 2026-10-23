package xxljob

import (
	"context"

	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/ssh"
)

// forwarderLease is the subset of an SSH local forwarder this package needs.
// It is an interface so tests can drive the tunnel branch without a live SSH
// server.
type forwarderLease interface {
	LocalAddress() string
	Release() error
}

type sshForwarderLeaseAdapter struct {
	forwarder *ssh.LocalForwarder
}

func (l *sshForwarderLeaseAdapter) LocalAddress() string {
	if l == nil || l.forwarder == nil {
		return ""
	}
	return l.forwarder.LocalAddr
}

func (l *sshForwarderLeaseAdapter) Release() error {
	if l == nil || l.forwarder == nil {
		return nil
	}
	return l.forwarder.Release()
}

// dialProxyContext is overridable in tests that need to assert the proxy branch.
var dialProxyContext = proxyDialContext

type acquireForwarderFunc func(
	sshConfig connection.SSHConfig,
	remoteHost string,
	remotePort int,
) (forwarderLease, error)

func (c *Client) resolveDialTarget(
	ctx context.Context,
	config connection.ConnectionConfig,
) (string, forwarderLease, error) {
	if !config.UseSSH {
		return "", nil, nil
	}
	acquire := c.acquire
	if acquire == nil {
		acquire = acquireXxlJobForwarder
	}
	lease, err := acquireForwarderWithContext(ctx, acquire, config.SSH, config.Host, config.Port)
	if err != nil {
		if ctxErr := ctx.Err(); ctxErr != nil {
			return "", nil, ctxErr
		}
		return "", nil, localizedXxlJobErrorWithCause("xxljob.backend.error.ssh_tunnel_failed", nil, err)
	}
	address := ""
	if lease != nil {
		address = lease.LocalAddress()
	}
	if strings.TrimSpace(address) == "" {
		releaseForwarder(lease)
		return "", nil, localizedXxlJobError("xxljob.backend.error.ssh_tunnel_failed", map[string]any{
			"detail": "local forward address is empty",
		})
	}
	return address, lease, nil
}

func acquireForwarderWithContext(
	ctx context.Context,
	acquire acquireForwarderFunc,
	sshConfig connection.SSHConfig,
	remoteHost string,
	remotePort int,
) (forwarderLease, error) {
	type result struct {
		lease forwarderLease
		err   error
	}
	// The SSH helper has no context-aware entry point; run it off the caller's
	// goroutine so a stalled handshake still honours cancellation.
	done := make(chan result, 1)
	go func() {
		lease, err := acquire(sshConfig, remoteHost, remotePort)
		done <- result{lease: lease, err: err}
	}()
	select {
	case out := <-done:
		return out.lease, out.err
	case <-ctx.Done():
		go func() {
			if out := <-done; out.lease != nil {
				releaseForwarder(out.lease)
			}
		}()
		return nil, ctx.Err()
	}
}

func releaseForwarder(lease forwarderLease) {
	if lease == nil {
		return
	}
	_ = lease.Release()
}

func acquireXxlJobForwarder(
	sshConfig connection.SSHConfig,
	remoteHost string,
	remotePort int,
) (forwarderLease, error) {
	forwarder, err := ssh.AcquireLocalForwarder(sshConfig, remoteHost, remotePort)
	if err != nil {
		return nil, err
	}
	return &sshForwarderLeaseAdapter{forwarder: forwarder}, nil
}
