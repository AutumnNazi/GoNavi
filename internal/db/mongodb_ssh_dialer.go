package db

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/ssh"
)

// MongoDB 通过 SSH 连接时不能直接把 x/crypto/ssh 的 channel 交给驱动：
// mongo-driver 会在每次握手时对 socket 设置读写 deadline，而 ssh 的
// chanConn 实现对这些调用一律返回 "ssh: tcpChan: deadline not supported"，
// 驱动随即把该错误折叠进 serverSelectionTimeout，最终表现为连接一直超时。
//
// 其余可选驱动都通过 ssh.AcquireLocalForwarder 拿到一个真实的本机 TCP
// 监听地址再连接，本文件让 MongoDB 采用同样的形态：远端地址仍取自 Mongo
// URI 的种子地址（即跳板机视角的 host:port），但驱动实际拨号的是本机转发
// 监听器，因此 deadline 语义正常，且 PermitOpen 拒绝、端口未监听等真实原因
// 可以在建立隧道时就抛出来。

// mongoTunnel 是 ssh.LocalForwarder 租约中 MongoDB 依赖的最小面。
// 抽象成接口是为了让测试可以用一个真实的本机监听器替代 SSH 服务端。
type mongoTunnel interface {
	// LocalAddress 是驱动应当拨号的本机监听地址。
	LocalAddress() string
	// RemoteAddress 是跳板机视角的远端地址。
	RemoteAddress() string
	// RemoteDialFailureSince 返回 since 之后由跳板机发起的失败拨号。
	RemoteDialFailureSince(since time.Time) (ssh.RemoteDialFailure, bool)
	// Release 释放本次租约。
	Release() error
}

// mongoSSHForwarderTunnel 把真实的 LocalForwarder 租约适配成 mongoTunnel。
type mongoSSHForwarderTunnel struct {
	forwarder *ssh.LocalForwarder
}

func (t *mongoSSHForwarderTunnel) LocalAddress() string {
	if t == nil || t.forwarder == nil {
		return ""
	}
	return t.forwarder.LocalAddr
}

func (t *mongoSSHForwarderTunnel) RemoteAddress() string {
	if t == nil || t.forwarder == nil {
		return ""
	}
	return t.forwarder.RemoteAddr
}

func (t *mongoSSHForwarderTunnel) RemoteDialFailureSince(since time.Time) (ssh.RemoteDialFailure, bool) {
	if t == nil || t.forwarder == nil {
		return ssh.RemoteDialFailure{}, false
	}
	return t.forwarder.RemoteDialFailureSince(since)
}

func (t *mongoSSHForwarderTunnel) Release() error {
	if t == nil || t.forwarder == nil {
		return nil
	}
	return t.forwarder.Release()
}

// mongoAcquireSSHTunnel / mongoVerifySSHRemoteTarget 是测试用的窄缝，
// 与既有的 mongoGetOrCreateSSHClient 保持同样的做法。
var (
	mongoAcquireSSHTunnel      = acquireMongoSSHForwarderTunnel
	mongoVerifySSHRemoteTarget = ssh.DialContextThroughSSH
)

func acquireMongoSSHForwarderTunnel(sshConfig connection.SSHConfig, remoteAddr string) (mongoTunnel, error) {
	host, portText, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		return nil, fmt.Errorf("%s", localizedDriverRuntimeText("db.backend.error.ssh_local_forward_addr_invalid", map[string]any{
			"address": remoteAddr,
		}))
	}
	port, convErr := strconv.Atoi(portText)
	if convErr != nil || port <= 0 {
		return nil, fmt.Errorf("%s", localizedDriverRuntimeText("db.backend.error.ssh_local_forward_addr_invalid", map[string]any{
			"address": remoteAddr,
		}))
	}

	forwarder, err := ssh.AcquireLocalForwarder(sshConfig, host, port)
	if err != nil {
		return nil, fmt.Errorf("%s%w", localizedDriverRuntimeText("db.backend.error.ssh_tunnel_create_failed", map[string]any{
			"detail": "",
		}), err)
	}
	return &mongoSSHForwarderTunnel{forwarder: forwarder}, nil
}

// mongoSSHDialer 让 mongo-driver 通过本机转发监听器访问 SSH 远端地址。
// 每个远端地址只建立一次转发，多个驱动连接共享同一个监听器。
type mongoSSHDialer struct {
	sshConfig connection.SSHConfig

	mu      sync.Mutex
	tunnels map[string]mongoTunnel
	closed  bool
}

func newMongoSSHDialer(sshConfig connection.SSHConfig) *mongoSSHDialer {
	return &mongoSSHDialer{
		sshConfig: sshConfig,
		tunnels:   make(map[string]mongoTunnel),
	}
}

// DialContext 实现 options.ContextDialer（v1 与 v2 驱动的签名一致）。
func (d *mongoSSHDialer) DialContext(ctx context.Context, network, address string) (net.Conn, error) {
	if d == nil {
		return nil, fmt.Errorf("MongoDB SSH 隧道未初始化")
	}
	if ctx == nil {
		ctx = context.Background()
	}

	localAddr, err := d.ensureTunnel(ctx, address)
	if err != nil {
		return nil, err
	}

	var dialer net.Dialer
	conn, err := dialer.DialContext(ctx, "tcp", localAddr)
	if err != nil {
		return nil, d.describeDialFailure(err, address)
	}
	return conn, nil
}

// ensureTunnel 返回该远端地址对应的本机监听地址，必要时建立并校验转发。
func (d *mongoSSHDialer) ensureTunnel(ctx context.Context, remoteAddr string) (string, error) {
	target := strings.TrimSpace(remoteAddr)
	if target == "" {
		return "", fmt.Errorf("%s", localizedDriverRuntimeText("db.backend.error.ssh_local_forward_addr_invalid", map[string]any{
			"address": remoteAddr,
		}))
	}

	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return "", fmt.Errorf("MongoDB SSH 隧道已关闭")
	}
	if tunnel := d.tunnels[target]; tunnel != nil {
		localAddr := tunnel.LocalAddress()
		d.mu.Unlock()
		return localAddr, nil
	}
	d.mu.Unlock()

	// 建立转发与预检都会访问网络，放在锁外执行；若并发重复建立，
	// 后到的租约会被释放，只保留先写入缓存的那一个。
	tunnel, err := mongoAcquireSSHTunnel(d.sshConfig, target)
	if err != nil {
		return "", err
	}

	// 预检跳板机到远端的拨号：sshd 的 PermitOpen 拒绝或端口未监听会在这里
	// 立即抛出真实原因，而不是等驱动重试到 serverSelectionTimeout 超时。
	if verifyErr := d.verifyRemoteTarget(ctx, tunnel); verifyErr != nil {
		_ = tunnel.Release()
		return "", verifyErr
	}

	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		_ = tunnel.Release()
		return "", fmt.Errorf("MongoDB SSH 隧道已关闭")
	}
	if existing := d.tunnels[target]; existing != nil {
		localAddr := existing.LocalAddress()
		d.mu.Unlock()
		_ = tunnel.Release()
		return localAddr, nil
	}
	d.tunnels[target] = tunnel
	localAddr := tunnel.LocalAddress()
	d.mu.Unlock()

	logger.Infof("MongoDB 已建立 SSH 本地端口转发：本地 %s -> 远程 %s", localAddr, target)
	return localAddr, nil
}

func (d *mongoSSHDialer) verifyRemoteTarget(ctx context.Context, tunnel mongoTunnel) error {
	if mongoVerifySSHRemoteTarget == nil || tunnel == nil {
		return nil
	}
	remoteAddr := strings.TrimSpace(tunnel.RemoteAddress())
	if remoteAddr == "" {
		return nil
	}
	conn, err := mongoVerifySSHRemoteTarget(ctx, d.sshConfig, "tcp", remoteAddr)
	if err != nil {
		return mongoTunnelError(err, tunnel.LocalAddress(), remoteAddr, false)
	}
	if conn != nil {
		_ = conn.Close()
	}
	return nil
}

// describeDialFailure 在本机监听器拒绝连接时补充远端地址上下文。
func (d *mongoSSHDialer) describeDialFailure(err error, remoteAddr string) error {
	if d == nil {
		return err
	}
	d.mu.Lock()
	tunnel := d.tunnels[strings.TrimSpace(remoteAddr)]
	d.mu.Unlock()
	if tunnel == nil {
		return err
	}
	return mongoTunnelError(err, tunnel.LocalAddress(), tunnel.RemoteAddress(), false)
}

// wrapConnectError 把驱动聚合后的 server selection 错误替换为跳板机真实的
// 拨号失败原因（例如 PermitOpen 拒绝）。
func (d *mongoSSHDialer) wrapConnectError(err error, since time.Time) error {
	if err == nil || d == nil {
		return err
	}

	d.mu.Lock()
	tunnels := make([]mongoTunnel, 0, len(d.tunnels))
	for _, tunnel := range d.tunnels {
		tunnels = append(tunnels, tunnel)
	}
	d.mu.Unlock()

	for _, tunnel := range tunnels {
		failure, ok := tunnel.RemoteDialFailureSince(since)
		if !ok || strings.TrimSpace(failure.RemoteAddr) == "" {
			continue
		}
		return wrapMongoTunnelRemoteDialFailure(err, tunnel.LocalAddress(), failure)
	}
	return err
}

// Close 释放所有本机转发租约。
func (d *mongoSSHDialer) Close() error {
	if d == nil {
		return nil
	}

	d.mu.Lock()
	if d.closed {
		d.mu.Unlock()
		return nil
	}
	d.closed = true
	tunnels := d.tunnels
	d.tunnels = nil
	d.mu.Unlock()

	var firstErr error
	for target, tunnel := range tunnels {
		if err := tunnel.Release(); err != nil {
			logger.Warnf("释放 MongoDB SSH 端口转发失败：目标=%s 错误=%v", target, err)
			if firstErr == nil {
				firstErr = err
			}
		}
	}
	return firstErr
}

// mongoTunnelError 复用与其他驱动一致的 SSH 隧道失败文案。
func mongoTunnelError(err error, localAddr, remoteAddr string, verified bool) error {
	if err == nil {
		return nil
	}
	remoteAddr = strings.TrimSpace(remoteAddr)
	if remoteAddr == "" {
		return err
	}
	localAddr = strings.TrimSpace(localAddr)
	if localAddr == "" {
		localAddr = "SSH local listener"
	}

	message := localizedDriverRuntimeText("db.backend.error.ssh_tunnel_remote_dial_failed", map[string]any{
		"localAddr":   localAddr,
		"remoteAddr":  remoteAddr,
		"remoteError": err,
	})
	if verified {
		prefix := localizedDriverRuntimeText("db.backend.error.connection_verify_failed_prefix", nil)
		return fmt.Errorf("%s%s%w", prefix, message, err)
	}
	return fmt.Errorf("%s%w", message, err)
}

func wrapMongoTunnelRemoteDialFailure(err error, localAddr string, failure ssh.RemoteDialFailure) error {
	if err == nil {
		return nil
	}
	remoteAddr := strings.TrimSpace(failure.RemoteAddr)
	if remoteAddr == "" {
		return err
	}
	localAddr = strings.TrimSpace(localAddr)
	if localAddr == "" {
		localAddr = "SSH local listener"
	}
	prefix := localizedDriverRuntimeText("db.backend.error.connection_verify_failed_prefix", nil)
	message := localizedDriverRuntimeText("db.backend.error.ssh_tunnel_remote_dial_failed", map[string]any{
		"localAddr":   localAddr,
		"remoteAddr":  remoteAddr,
		"remoteError": failure.Err,
	})
	return fmt.Errorf("%s%s%w", prefix, message, err)
}
