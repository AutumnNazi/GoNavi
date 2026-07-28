package app

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/nacos"
	"GoNavi-Wails/internal/uievents"
)

const (
	nacosConfigChangedEvent   = "nacos:config-changed"
	nacosListenTimeoutMs      = 30000
	nacosListenMaxSessions    = 32
	nacosListenRestartBackoff = 800 * time.Millisecond
)

// NacosStartConfigListenPayload starts long-poll watching for one config.
type NacosStartConfigListenPayload struct {
	WatchID      string `json:"watchId,omitempty"`
	ConnectionID string `json:"connectionId,omitempty"`
	NamespaceID  string `json:"namespaceId"`
	DataID       string `json:"dataId"`
	Group        string `json:"group"`
	ContentMD5   string `json:"contentMd5,omitempty"`
}

// NacosConfigChangedEvent is emitted when remote config changes.
type NacosConfigChangedEvent struct {
	WatchID      string `json:"watchId"`
	ConnectionID string `json:"connectionId,omitempty"`
	NamespaceID  string `json:"namespaceId,omitempty"`
	DataID       string `json:"dataId"`
	Group        string `json:"group"`
	ChangedAt    int64  `json:"changedAt"`
}

type nacosListenSession struct {
	watchID      string
	connectionID string
	namespaceID  string
	dataID       string
	group        string
	contentMD5   string
	cancel       context.CancelFunc
}

var (
	nacosListenMu       sync.Mutex
	nacosListenSessions = make(map[string]*nacosListenSession)
)

// NacosStartConfigListen starts background long-poll for a config.
func (a *App) NacosStartConfigListen(config connection.ConnectionConfig, payload NacosStartConfigListenPayload) connection.QueryResult {
	config.Type = "nacos"
	dataID := strings.TrimSpace(payload.DataID)
	group := strings.TrimSpace(payload.Group)
	if dataID == "" {
		return connection.QueryResult{Success: false, Message: a.appText("nacos.backend.error.data_id_required", nil)}
	}
	if group == "" {
		group = "DEFAULT_GROUP"
	}
	namespaceID := strings.TrimSpace(payload.NamespaceID)
	if strings.EqualFold(namespaceID, "public") {
		namespaceID = ""
	}
	contentMD5 := strings.TrimSpace(payload.ContentMD5)
	if contentMD5 == "" {
		// empty means "unknown local content"; first change will fire if config exists remotely
		contentMD5 = ""
	}

	// Ensure client can connect before starting loop.
	if _, err := a.getNacosClient(config); err != nil {
		return connection.QueryResult{Success: false, Message: err.Error()}
	}

	watchID := strings.TrimSpace(payload.WatchID)
	if watchID == "" {
		watchID = newNacosWatchID()
	}

	nacosListenMu.Lock()
	if existing, ok := nacosListenSessions[watchID]; ok && existing != nil {
		existing.cancel()
		delete(nacosListenSessions, watchID)
	}
	if len(nacosListenSessions) >= nacosListenMaxSessions {
		nacosListenMu.Unlock()
		return connection.QueryResult{Success: false, Message: a.appText("nacos.backend.error.listen_limit", nil)}
	}

	ctx, cancel := context.WithCancel(context.Background())
	session := &nacosListenSession{
		watchID:      watchID,
		connectionID: strings.TrimSpace(payload.ConnectionID),
		namespaceID:  namespaceID,
		dataID:       dataID,
		group:        group,
		contentMD5:   contentMD5,
		cancel:       cancel,
	}
	nacosListenSessions[watchID] = session
	nacosListenMu.Unlock()

	go a.runNacosConfigListenLoop(config, session, ctx)
	logger.Infof("Nacos 配置监听已启动：watchId=%s dataId=%s group=%s", watchID, dataID, group)
	return connection.QueryResult{
		Success: true,
		Message: a.appText("nacos.backend.message.listen_started", nil),
		Data: map[string]any{
			"watchId": watchID,
		},
	}
}

// NacosStopConfigListen stops one listen session.
func (a *App) NacosStopConfigListen(watchID string) connection.QueryResult {
	watchID = strings.TrimSpace(watchID)
	if watchID == "" {
		return connection.QueryResult{Success: false, Message: a.appText("nacos.backend.error.listen_watch_id_required", nil)}
	}
	nacosListenMu.Lock()
	session, ok := nacosListenSessions[watchID]
	if ok {
		session.cancel()
		delete(nacosListenSessions, watchID)
	}
	nacosListenMu.Unlock()
	if !ok {
		return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.listen_stopped", nil)}
	}
	logger.Infof("Nacos 配置监听已停止：watchId=%s", watchID)
	return connection.QueryResult{Success: true, Message: a.appText("nacos.backend.message.listen_stopped", nil)}
}

// NacosUpdateConfigListenMD5 updates the content MD5 used by an active listener.
func (a *App) NacosUpdateConfigListenMD5(watchID, contentMD5 string) connection.QueryResult {
	watchID = strings.TrimSpace(watchID)
	if watchID == "" {
		return connection.QueryResult{Success: false, Message: a.appText("nacos.backend.error.listen_watch_id_required", nil)}
	}
	nacosListenMu.Lock()
	session, ok := nacosListenSessions[watchID]
	if ok && session != nil {
		session.contentMD5 = strings.TrimSpace(contentMD5)
	}
	nacosListenMu.Unlock()
	if !ok {
		return connection.QueryResult{Success: false, Message: a.appText("nacos.backend.error.listen_not_found", nil)}
	}
	return connection.QueryResult{Success: true}
}

func (a *App) runNacosConfigListenLoop(config connection.ConnectionConfig, session *nacosListenSession, ctx context.Context) {
	defer func() {
		nacosListenMu.Lock()
		if current, ok := nacosListenSessions[session.watchID]; ok && current == session {
			delete(nacosListenSessions, session.watchID)
		}
		nacosListenMu.Unlock()
	}()

	for {
		if ctx.Err() != nil {
			return
		}
		client, err := a.getNacosClient(config)
		if err != nil {
			logger.Warnf("Nacos 监听获取连接失败，稍后重试：watchId=%s err=%v", session.watchID, err)
			if !sleepWithContext(ctx, nacosListenRestartBackoff) {
				return
			}
			continue
		}

		nacosListenMu.Lock()
		md5 := session.contentMD5
		nacosListenMu.Unlock()

		changed, err := client.ListenOnce(ctx, []nacos.ConfigListenTarget{{
			NamespaceID: session.namespaceID,
			DataID:      session.dataID,
			Group:       session.group,
			ContentMD5:  md5,
		}}, nacosListenTimeoutMs)
		if ctx.Err() != nil {
			return
		}
		if err != nil {
			logger.Warnf("Nacos 监听轮询失败，稍后重试：watchId=%s err=%v", session.watchID, err)
			if !sleepWithContext(ctx, nacosListenRestartBackoff) {
				return
			}
			continue
		}
		if len(changed) == 0 {
			continue
		}

		// Emit change event for matching target.
		for _, item := range changed {
			if !nacosListenTargetMatch(session, item) {
				continue
			}
			a.emitNacosConfigChanged(NacosConfigChangedEvent{
				WatchID:      session.watchID,
				ConnectionID: session.connectionID,
				NamespaceID:  session.namespaceID,
				DataID:       session.dataID,
				Group:        session.group,
				ChangedAt:    time.Now().UnixMilli(),
			})
		}
		// Small pause to avoid tight loop if client keeps reporting change before MD5 update.
		if !sleepWithContext(ctx, 300*time.Millisecond) {
			return
		}
	}
}

func nacosListenTargetMatch(session *nacosListenSession, item nacos.ConfigListenTarget) bool {
	if !strings.EqualFold(strings.TrimSpace(item.DataID), session.dataID) {
		return false
	}
	itemGroup := strings.TrimSpace(item.Group)
	if itemGroup == "" {
		itemGroup = "DEFAULT_GROUP"
	}
	if !strings.EqualFold(itemGroup, session.group) {
		return false
	}
	// tenant empty and public are equivalent
	return normalizeNacosListenNamespace(item.NamespaceID) == normalizeNacosListenNamespace(session.namespaceID)
}

func normalizeNacosListenNamespace(raw string) string {
	id := strings.TrimSpace(raw)
	if strings.EqualFold(id, "public") {
		return ""
	}
	return id
}

func (a *App) emitNacosConfigChanged(event NacosConfigChangedEvent) {
	if a == nil {
		return
	}
	// Prefer app context for Wails runtime events.
	if a.ctx != nil {
		uievents.Emit(a.ctx, nacosConfigChangedEvent, event)
		return
	}
	uievents.Emit(context.Background(), nacosConfigChangedEvent, event)
}

func sleepWithContext(ctx context.Context, d time.Duration) bool {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func newNacosWatchID() string {
	var buf [8]byte
	if _, err := rand.Read(buf[:]); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format("150405.000000000")))
	}
	return hex.EncodeToString(buf[:]) + hex.EncodeToString([]byte(time.Now().Format("150405")))
}

// CloseAllNacosListeners stops all config listeners.
func CloseAllNacosListeners() {
	nacosListenMu.Lock()
	sessions := make([]*nacosListenSession, 0, len(nacosListenSessions))
	for _, session := range nacosListenSessions {
		sessions = append(sessions, session)
	}
	nacosListenSessions = make(map[string]*nacosListenSession)
	nacosListenMu.Unlock()

	for _, session := range sessions {
		if session != nil && session.cancel != nil {
			session.cancel()
		}
	}
}

// CloseAllNacosClients closes cached nacos clients and listeners.
func CloseAllNacosClients() {
	CloseAllNacosListeners()

	nacosCacheMu.Lock()
	defer nacosCacheMu.Unlock()
	for key, client := range nacosCache {
		if client != nil {
			_ = client.Close()
			if len(key) >= 12 {
				logger.Infof("已关闭 Nacos 连接：%s", key[:12])
			}
		}
	}
	nacosCache = make(map[string]nacos.Client)
	nacosCacheConfigs = make(map[string]connection.ConnectionConfig)
}
