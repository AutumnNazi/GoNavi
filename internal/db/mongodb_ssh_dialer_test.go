package db

import (
	"context"
	"errors"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/ssh"
)

// fakeMongoTunnel 用一个真实的本机监听器冒充 ssh.LocalForwarder 租约，
// 这样测试不需要 SSH 服务端也能覆盖 MongoDB 拨号路径。
type fakeMongoTunnel struct {
	listener   net.Listener
	remoteAddr string

	mu        sync.Mutex
	failure   *ssh.RemoteDialFailure
	releases  int
	accepted  int
	acceptedC chan struct{}
	conns     []net.Conn
}

func newFakeMongoTunnel(t *testing.T, remoteAddr string) *fakeMongoTunnel {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("监听本机端口失败：%v", err)
	}
	tunnel := &fakeMongoTunnel{
		listener:   listener,
		remoteAddr: remoteAddr,
		acceptedC:  make(chan struct{}, 16),
	}
	go func() {
		for {
			conn, acceptErr := listener.Accept()
			if acceptErr != nil {
				return
			}
			tunnel.mu.Lock()
			tunnel.accepted++
			tunnel.conns = append(tunnel.conns, conn)
			tunnel.mu.Unlock()
			select {
			case tunnel.acceptedC <- struct{}{}:
			default:
			}
		}
	}()
	t.Cleanup(func() {
		_ = listener.Close()
		tunnel.mu.Lock()
		for _, conn := range tunnel.conns {
			_ = conn.Close()
		}
		tunnel.conns = nil
		tunnel.mu.Unlock()
	})
	return tunnel
}

func (f *fakeMongoTunnel) LocalAddress() string  { return f.listener.Addr().String() }
func (f *fakeMongoTunnel) RemoteAddress() string { return f.remoteAddr }

func (f *fakeMongoTunnel) RemoteDialFailureSince(since time.Time) (ssh.RemoteDialFailure, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failure == nil {
		return ssh.RemoteDialFailure{}, false
	}
	if !since.IsZero() && !f.failure.OccurredAt.After(since) {
		return ssh.RemoteDialFailure{}, false
	}
	return *f.failure, true
}

func (f *fakeMongoTunnel) Release() error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.releases++
	return nil
}

func (f *fakeMongoTunnel) releaseCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.releases
}

func (f *fakeMongoTunnel) acceptCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.accepted
}

// waitForAccept 等待监听器真正接受一个连接。net.Dial 在内核完成三次握手后
// 即返回，accept 协程可能还没被调度，因此不能直接断言计数。
func (f *fakeMongoTunnel) waitForAccept(t *testing.T, timeout time.Duration) {
	t.Helper()
	select {
	case <-f.acceptedC:
	case <-time.After(timeout):
		t.Fatalf("%v 内本机转发监听器没有收到连接", timeout)
	}
}

// stubMongoSSHDialerSeams 替换两个测试窄缝并在测试结束时还原。
func stubMongoSSHDialerSeams(
	t *testing.T,
	acquire func(connection.SSHConfig, string) (mongoTunnel, error),
	verify func(context.Context, connection.SSHConfig, string, string) (net.Conn, error),
) *int {
	t.Helper()
	previousAcquire := mongoAcquireSSHTunnel
	previousVerify := mongoVerifySSHRemoteTarget
	t.Cleanup(func() {
		mongoAcquireSSHTunnel = previousAcquire
		mongoVerifySSHRemoteTarget = previousVerify
	})
	if acquire != nil {
		mongoAcquireSSHTunnel = acquire
	}
	if verify != nil {
		mongoVerifySSHRemoteTarget = verify
	}
	calls := new(int)
	return calls
}

// TestMongoSSHDialerDialsLocalForwarderSocket 是本缺陷的回归守卫：
// mongo-driver 会给连接设置 socket deadline，而 x/crypto/ssh 的 channel 对
// deadline 一律报 "ssh: tcpChan: deadline not supported"。拨号必须落到本机
// 转发监听器返回的真实 TCP socket 上。
func TestMongoSSHDialerDialsLocalForwarderSocket(t *testing.T) {
	tunnel := newFakeMongoTunnel(t, "127.0.0.1:17017")
	acquired := 0
	stubMongoSSHDialerSeams(t,
		func(connection.SSHConfig, string) (mongoTunnel, error) {
			acquired++
			return tunnel, nil
		},
		func(context.Context, connection.SSHConfig, string, string) (net.Conn, error) {
			return nil, nil
		},
	)

	dialer := newMongoSSHDialer(connection.SSHConfig{Host: "jump.example", Port: 22, User: "root"})
	conn, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:17017")
	if err != nil {
		t.Fatalf("DialContext() 应通过本机转发成功，实际错误：%v", err)
	}
	defer func() { _ = conn.Close() }()
	t.Cleanup(func() { _ = dialer.Close() })

	if acquired != 1 {
		t.Fatalf("应只建立 1 次转发，实际 %d", acquired)
	}
	tunnel.waitForAccept(t, 2*time.Second)
	if got := tunnel.acceptCount(); got != 1 {
		t.Fatalf("本机转发监听器应收到 1 个连接，实际 %d", got)
	}

	// 关键断言：驱动拿到的连接必须支持 deadline 语义。
	if err := conn.SetWriteDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("连接不支持写 deadline（MongoDB 驱动会因此超时）：%v", err)
	}
	if err := conn.SetReadDeadline(time.Now().Add(time.Second)); err != nil {
		t.Fatalf("连接不支持读 deadline（MongoDB 驱动会因此超时）：%v", err)
	}
	if err := conn.SetDeadline(time.Time{}); err != nil {
		t.Fatalf("连接不支持清除 deadline：%v", err)
	}
}

// TestMongoSSHDialerSurfacesPermitOpenRejection 覆盖“端口/PermitOpen 错误要能
// 正常抛出”：跳板机拒绝拨号时必须在建立阶段就返回 sshd 的真实原因，而不是
// 让驱动重试到 serverSelectionTimeout。
func TestMongoSSHDialerSurfacesPermitOpenRejection(t *testing.T) {
	tunnel := newFakeMongoTunnel(t, "127.0.0.1:27017")
	sentinel := errors.New("ssh: rejected: connect failed (administratively prohibited)")
	stubMongoSSHDialerSeams(t,
		func(connection.SSHConfig, string) (mongoTunnel, error) {
			return tunnel, nil
		},
		func(context.Context, connection.SSHConfig, string, string) (net.Conn, error) {
			return nil, sentinel
		},
	)

	dialer := newMongoSSHDialer(connection.SSHConfig{Host: "jump.example", Port: 22, User: "root"})
	t.Cleanup(func() { _ = dialer.Close() })

	conn, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:27017")
	if conn != nil {
		_ = conn.Close()
		t.Fatal("隧道不可用时不应返回连接")
	}
	if err == nil {
		t.Fatal("跳板机拒绝拨号时应返回错误")
	}
	if !errors.Is(err, sentinel) {
		t.Fatalf("错误应可 unwrap 到原始 sshd 原因，实际：%v", err)
	}
	message := err.Error()
	if !strings.Contains(message, "administratively prohibited") {
		t.Fatalf("错误信息应包含 sshd 原始原因，实际：%s", message)
	}
	if !strings.Contains(message, "127.0.0.1:27017") {
		t.Fatalf("错误信息应包含远端目标地址，实际：%s", message)
	}
	if got := tunnel.acceptCount(); got != 0 {
		t.Fatalf("校验失败时不应把连接放进转发器，实际接受 %d 个", got)
	}
	if got := tunnel.releaseCount(); got != 1 {
		t.Fatalf("校验失败时应释放刚建立的租约，实际释放 %d 次", got)
	}
}

// TestMongoSSHDialerReusesTunnelForSameRemoteAddress 保证同一个远端地址只建立
// 一次转发、只做一次预检（驱动连接池会反复拨号同一地址）。
func TestMongoSSHDialerReusesTunnelForSameRemoteAddress(t *testing.T) {
	tunnel := newFakeMongoTunnel(t, "127.0.0.1:17017")
	acquired := 0
	verified := 0
	stubMongoSSHDialerSeams(t,
		func(connection.SSHConfig, string) (mongoTunnel, error) {
			acquired++
			return tunnel, nil
		},
		func(context.Context, connection.SSHConfig, string, string) (net.Conn, error) {
			verified++
			return nil, nil
		},
	)

	dialer := newMongoSSHDialer(connection.SSHConfig{Host: "jump.example", Port: 22, User: "root"})
	t.Cleanup(func() { _ = dialer.Close() })

	for i := 0; i < 3; i++ {
		conn, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:17017")
		if err != nil {
			t.Fatalf("第 %d 次 DialContext() 失败：%v", i+1, err)
		}
		_ = conn.Close()
	}
	if acquired != 1 {
		t.Fatalf("同一地址应复用转发，实际建立 %d 次", acquired)
	}
	if verified != 1 {
		t.Fatalf("同一地址应只预检一次，实际 %d 次", verified)
	}
}

// TestMongoSSHDialerCloseReleasesTunnels 保证连接关闭后不残留本机转发。
func TestMongoSSHDialerCloseReleasesTunnels(t *testing.T) {
	tunnel := newFakeMongoTunnel(t, "127.0.0.1:17017")
	stubMongoSSHDialerSeams(t,
		func(connection.SSHConfig, string) (mongoTunnel, error) {
			return tunnel, nil
		},
		func(context.Context, connection.SSHConfig, string, string) (net.Conn, error) {
			return nil, nil
		},
	)

	dialer := newMongoSSHDialer(connection.SSHConfig{Host: "jump.example", Port: 22, User: "root"})
	conn, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:17017")
	if err != nil {
		t.Fatalf("DialContext() 失败：%v", err)
	}
	_ = conn.Close()

	if err := dialer.Close(); err != nil {
		t.Fatalf("Close() 失败：%v", err)
	}
	if got := tunnel.releaseCount(); got != 1 {
		t.Fatalf("Close() 应释放 1 次租约，实际 %d", got)
	}

	if _, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:17017"); err == nil {
		t.Fatal("已关闭的 dialer 不应再建立连接")
	}
	if err := dialer.Close(); err != nil {
		t.Fatalf("重复 Close() 应幂等，实际错误：%v", err)
	}
	if got := tunnel.releaseCount(); got != 1 {
		t.Fatalf("重复 Close() 不应重复释放，实际 %d 次", got)
	}
}

// TestMongoSSHDialerWrapConnectErrorUsesRemoteDialFailure 覆盖兜底路径：
// 若驱动仍把失败聚合成了 server selection 错误，也要把跳板机的真实原因补回。
func TestMongoSSHDialerWrapConnectErrorUsesRemoteDialFailure(t *testing.T) {
	tunnel := newFakeMongoTunnel(t, "127.0.0.1:17017")
	sentinel := errors.New("ssh: rejected: connect failed (Connection refused)")
	tunnel.mu.Lock()
	tunnel.failure = &ssh.RemoteDialFailure{
		RemoteAddr: "127.0.0.1:17017",
		Err:        sentinel,
		OccurredAt: time.Now(),
	}
	tunnel.mu.Unlock()

	stubMongoSSHDialerSeams(t,
		func(connection.SSHConfig, string) (mongoTunnel, error) {
			return tunnel, nil
		},
		func(context.Context, connection.SSHConfig, string, string) (net.Conn, error) {
			return nil, nil
		},
	)

	dialer := newMongoSSHDialer(connection.SSHConfig{Host: "jump.example", Port: 22, User: "root"})
	t.Cleanup(func() { _ = dialer.Close() })

	conn, err := dialer.DialContext(context.Background(), "tcp", "127.0.0.1:17017")
	if err != nil {
		t.Fatalf("DialContext() 失败：%v", err)
	}
	_ = conn.Close()

	driverErr := errors.New("server selection error: context deadline exceeded")
	wrapped := dialer.wrapConnectError(driverErr, time.Now().Add(-time.Minute))
	if !errors.Is(wrapped, driverErr) {
		t.Fatalf("包装后应保留原始驱动错误，实际：%v", wrapped)
	}
	message := wrapped.Error()
	if !strings.Contains(message, "Connection refused") {
		t.Fatalf("包装后应包含跳板机真实原因，实际：%s", message)
	}
	if !strings.Contains(message, "127.0.0.1:17017") {
		t.Fatalf("包装后应包含远端目标地址，实际：%s", message)
	}
}

// TestMongoSSHDialerRejectsInvalidRemoteAddress 覆盖种子地址非法的情况。
func TestMongoSSHDialerRejectsInvalidRemoteAddress(t *testing.T) {
	dialer := newMongoSSHDialer(connection.SSHConfig{Host: "jump.example", Port: 22, User: "root"})
	t.Cleanup(func() { _ = dialer.Close() })

	if _, err := dialer.DialContext(context.Background(), "tcp", "no-port-host"); err == nil {
		t.Fatal("缺少端口的地址应被拒绝")
	}
	if _, err := dialer.DialContext(context.Background(), "tcp", "   "); err == nil {
		t.Fatal("空地址应被拒绝")
	}
}
