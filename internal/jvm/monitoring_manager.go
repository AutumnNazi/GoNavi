package jvm

import (
	"context"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/connection"
)

const (
	defaultMonitoringPointLimit = 180
	defaultMonitoringEventLimit = 20
	defaultMonitoringInterval   = 2 * time.Second
	maxMonitoringSampleFailures = 3
	defaultStoppedSessionTTL    = 30 * time.Minute
	defaultMaxStoppedSessions   = 64
)

const (
	monitoringSnapshotUnsupportedKey = "jvm.backend.monitoring.error.snapshot_unsupported"
	monitoringSessionNotFoundKey     = "jvm.backend.monitoring.error.session_not_found"
)

const (
	monitoringWarningMarkerPrefix         = "__gonavi_i18n__:"
	monitoringSampleAutoStoppedWarningKey = "jvm.backend.monitoring.warning.sample_auto_stopped"
)

var monitoringProviderFactory = NewProvider

type monitoringManager struct {
	mu                 sync.Mutex
	limit              int
	interval           time.Duration
	stoppedSessionTTL  time.Duration
	maxStoppedSessions int
	now                func() time.Time
	shutdown           bool
	sessions           map[string]*monitoringSession
}

type monitoringSession struct {
	mu               sync.Mutex
	connectionID     string
	providerMode     string
	limit            int
	running          bool
	points           []JVMMonitoringPoint
	recentGCEvents   []RecentGCEvent
	availableMetrics []string
	missingMetrics   []string
	providerWarnings []string
	cancel           context.CancelFunc
	generation       int64
	lastTouched      time.Time
}

func newMonitoringManagerForTest(limit int) *monitoringManager {
	return newMonitoringManager(limit, 0)
}

func NewMonitoringManager() *monitoringManager {
	return newMonitoringManager(defaultMonitoringPointLimit, defaultMonitoringInterval)
}

func newMonitoringManager(limit int, interval time.Duration) *monitoringManager {
	if limit <= 0 {
		limit = defaultMonitoringPointLimit
	}
	return &monitoringManager{
		limit:              limit,
		interval:           interval,
		stoppedSessionTTL:  defaultStoppedSessionTTL,
		maxStoppedSessions: defaultMaxStoppedSessions,
		now:                time.Now,
		sessions:           make(map[string]*monitoringSession),
	}
}

func (m *monitoringManager) ensureSession(connectionID string, providerMode string) *monitoringSession {
	m.mu.Lock()
	defer m.mu.Unlock()

	key := connectionID + ":" + providerMode
	if session, ok := m.sessions[key]; ok {
		return session
	}

	session := &monitoringSession{
		connectionID: connectionID,
		providerMode: providerMode,
		limit:        m.limit,
		lastTouched:  m.currentTime(),
	}
	m.sessions[key] = session
	return session
}

func (m *monitoringManager) Start(ctx context.Context, raw connection.ConnectionConfig, requestedMode string) (MonitoringSessionSnapshot, error) {
	cfg, providerMode, err := ResolveProviderMode(raw, requestedMode)
	if err != nil {
		return MonitoringSessionSnapshot{}, err
	}

	connectionID := resolveMonitoringConnectionID(cfg)

	provider, err := monitoringProviderFactory(providerMode)
	if err != nil {
		return MonitoringSessionSnapshot{}, err
	}

	monitoringProvider, ok := provider.(MonitoringCapableProvider)
	if !ok {
		return MonitoringSessionSnapshot{}, &LocalizedError{
			Key: monitoringSnapshotUnsupportedKey,
			Params: map[string]any{
				"provider": ModeDisplayLabel(providerMode),
			},
		}
	}

	now := m.currentTime()
	session := &monitoringSession{
		connectionID: connectionID,
		providerMode: providerMode,
		limit:        m.limit,
		lastTouched:  now,
	}
	generation := session.resetAt(connectionID, providerMode, now)
	if err := m.sampleOnce(ctx, monitoringProvider, cfg, session, generation); err != nil {
		session.markStoppedAt(generation, m.currentTime())
		return MonitoringSessionSnapshot{}, err
	}

	session.markRunningAt(generation, m.currentTime())
	var loopCtx context.Context
	if m.interval > 0 {
		var cancel context.CancelFunc
		loopCtx, cancel = context.WithCancel(context.Background())
		session.setCancel(cancel)
	}

	key := m.sessionKey(connectionID, providerMode)
	m.mu.Lock()
	if m.shutdown {
		m.mu.Unlock()
		session.stopAt(m.currentTime())
		return MonitoringSessionSnapshot{}, fmt.Errorf("JVM monitoring manager is shut down")
	}
	previous := m.sessions[key]
	m.sessions[key] = session
	m.pruneStoppedSessionsLocked(m.currentTime())
	m.mu.Unlock()

	if previous != nil && previous != session {
		previous.stopAt(m.currentTime())
	}
	if loopCtx != nil {
		go m.runSampler(loopCtx, monitoringProvider, cfg, session, generation)
	}

	return session.snapshot(), nil
}

func (m *monitoringManager) Stop(connectionID string, providerMode string) error {
	m.mu.Lock()
	session, ok := m.sessions[m.sessionKey(connectionID, providerMode)]
	m.mu.Unlock()
	if !ok {
		return monitoringSessionNotFoundError(connectionID, providerMode)
	}

	session.stopAt(m.currentTime())
	m.pruneStoppedSessions(m.currentTime())
	return nil
}

func (m *monitoringManager) GetHistory(connectionID string, providerMode string) (MonitoringSessionSnapshot, error) {
	now := m.currentTime()
	m.mu.Lock()
	m.pruneStoppedSessionsLocked(now)
	session, ok := m.sessions[m.sessionKey(connectionID, providerMode)]
	m.mu.Unlock()
	if !ok {
		return MonitoringSessionSnapshot{}, monitoringSessionNotFoundError(connectionID, providerMode)
	}
	snapshot := session.snapshotAndTouch(now)
	return snapshot, nil
}

// Shutdown stops every sampler and releases all retained histories.
func (m *monitoringManager) Shutdown() {
	m.mu.Lock()
	if m.shutdown {
		m.mu.Unlock()
		return
	}
	m.shutdown = true
	sessions := make([]*monitoringSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	m.sessions = make(map[string]*monitoringSession)
	m.mu.Unlock()

	now := m.currentTime()
	for _, session := range sessions {
		session.stopAt(now)
	}
}

func (m *monitoringManager) currentTime() time.Time {
	if m.now != nil {
		return m.now()
	}
	return time.Now()
}

func (m *monitoringManager) pruneStoppedSessions(now time.Time) {
	m.mu.Lock()
	m.pruneStoppedSessionsLocked(now)
	m.mu.Unlock()
}

func (m *monitoringManager) pruneStoppedSessionsLocked(now time.Time) {
	type candidate struct {
		key         string
		session     *monitoringSession
		lastTouched time.Time
	}

	retained := make([]candidate, 0, len(m.sessions))
	for key, session := range m.sessions {
		running, lastTouched := session.retentionState()
		if running {
			continue
		}
		if m.stoppedSessionTTL > 0 && !lastTouched.IsZero() && !now.Before(lastTouched.Add(m.stoppedSessionTTL)) {
			delete(m.sessions, key)
			continue
		}
		retained = append(retained, candidate{key: key, session: session, lastTouched: lastTouched})
	}

	if m.maxStoppedSessions <= 0 || len(retained) <= m.maxStoppedSessions {
		return
	}
	sort.Slice(retained, func(i, j int) bool {
		if retained[i].lastTouched.Equal(retained[j].lastTouched) {
			return retained[i].key < retained[j].key
		}
		return retained[i].lastTouched.Before(retained[j].lastTouched)
	})
	for _, item := range retained[:len(retained)-m.maxStoppedSessions] {
		if m.sessions[item.key] == item.session {
			delete(m.sessions, item.key)
		}
	}
}

func monitoringSessionNotFoundError(connectionID string, providerMode string) error {
	return &LocalizedError{
		Key: monitoringSessionNotFoundKey,
		Params: map[string]any{
			"connectionId": connectionID,
			"providerMode": providerMode,
		},
	}
}

func (s *monitoringSession) appendPoint(point JVMMonitoringPoint) {
	s.mu.Lock()
	defer s.mu.Unlock()

	s.points = append(s.points, point)
	if len(s.points) > s.limit {
		s.points = append([]JVMMonitoringPoint(nil), s.points[len(s.points)-s.limit:]...)
	}
}

func (m *monitoringManager) sessionKey(connectionID string, providerMode string) string {
	return strings.TrimSpace(connectionID) + ":" + strings.TrimSpace(providerMode)
}

func (m *monitoringManager) runSampler(ctx context.Context, provider MonitoringCapableProvider, cfg connection.ConnectionConfig, session *monitoringSession, generation int64) {
	ticker := time.NewTicker(m.interval)
	defer ticker.Stop()
	consecutiveFailures := 0

	for {
		select {
		case <-ctx.Done():
			if session.markStoppedAt(generation, m.currentTime()) {
				m.pruneStoppedSessions(m.currentTime())
			}
			return
		case <-ticker.C:
			if err := m.sampleOnce(ctx, provider, cfg, session, generation); err != nil {
				consecutiveFailures++
				session.appendWarning(err.Error())
				if consecutiveFailures >= maxMonitoringSampleFailures {
					session.appendWarning(FormatMonitoringSampleAutoStoppedWarning(consecutiveFailures))
					if session.markStoppedAt(generation, m.currentTime()) {
						m.pruneStoppedSessions(m.currentTime())
					}
					return
				}
				continue
			}
			consecutiveFailures = 0
		}
	}
}

func (m *monitoringManager) sampleOnce(ctx context.Context, provider MonitoringCapableProvider, cfg connection.ConnectionConfig, session *monitoringSession, generation int64) error {
	previous, ok := session.previousPoint(generation)
	if !ok {
		return nil
	}
	snapshot, err := provider.GetMonitoringSnapshot(ctx, cfg, previous)
	if err != nil {
		return err
	}
	session.applySnapshot(snapshot, generation)
	return nil
}

func (s *monitoringSession) snapshot() MonitoringSessionSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *monitoringSession) snapshotAndTouch(now time.Time) MonitoringSessionSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lastTouched = now
	return s.snapshotLocked()
}

func (s *monitoringSession) snapshotLocked() MonitoringSessionSnapshot {
	return MonitoringSessionSnapshot{
		ConnectionID:     s.connectionID,
		ProviderMode:     s.providerMode,
		Running:          s.running,
		Points:           append([]JVMMonitoringPoint(nil), s.points...),
		RecentGCEvents:   append([]RecentGCEvent(nil), s.recentGCEvents...),
		AvailableMetrics: append([]string(nil), s.availableMetrics...),
		MissingMetrics:   append([]string(nil), s.missingMetrics...),
		ProviderWarnings: append([]string(nil), s.providerWarnings...),
	}
}

func (s *monitoringSession) previousPoint(generation int64) (*JVMMonitoringPoint, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	if generation != s.generation {
		return nil, false
	}
	if len(s.points) == 0 {
		return nil, true
	}
	point := s.points[len(s.points)-1]
	if point.ThreadStateCounts != nil {
		point.ThreadStateCounts = cloneStringIntMap(point.ThreadStateCounts)
	}
	return &point, true
}

func (s *monitoringSession) applySnapshot(snapshot JVMMonitoringSnapshot, generation int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()

	if generation != s.generation {
		return false
	}
	s.points = append(s.points, cloneMonitoringPoint(snapshot.Point))
	if len(s.points) > s.limit {
		s.points = append([]JVMMonitoringPoint(nil), s.points[len(s.points)-s.limit:]...)
	}
	s.recentGCEvents = append([]RecentGCEvent(nil), snapshot.RecentGCEvents...)
	if len(s.recentGCEvents) > defaultMonitoringEventLimit {
		s.recentGCEvents = append([]RecentGCEvent(nil), s.recentGCEvents[len(s.recentGCEvents)-defaultMonitoringEventLimit:]...)
	}
	s.availableMetrics = append([]string(nil), snapshot.AvailableMetrics...)
	s.missingMetrics = append([]string(nil), snapshot.MissingMetrics...)
	s.providerWarnings = append([]string(nil), snapshot.ProviderWarnings...)
	return true
}

func FormatMonitoringSampleAutoStoppedWarning(count int) string {
	return fmt.Sprintf("%s%s:count=%d", monitoringWarningMarkerPrefix, monitoringSampleAutoStoppedWarningKey, count)
}

func ParseMonitoringProviderWarning(warning string) (string, map[string]any, bool) {
	payload, ok := strings.CutPrefix(strings.TrimSpace(warning), monitoringWarningMarkerPrefix)
	if !ok {
		return "", nil, false
	}
	key, rawParams, ok := strings.Cut(payload, ":")
	if !ok || key != monitoringSampleAutoStoppedWarningKey {
		return "", nil, false
	}
	name, value, ok := strings.Cut(rawParams, "=")
	if !ok || name != "count" {
		return "", nil, false
	}
	count, err := strconv.Atoi(value)
	if err != nil {
		return "", nil, false
	}
	return key, map[string]any{"count": count}, true
}

func (s *monitoringSession) appendWarning(warning string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	trimmed := strings.TrimSpace(warning)
	if trimmed == "" {
		return
	}
	for _, existing := range s.providerWarnings {
		if existing == trimmed {
			return
		}
	}
	s.providerWarnings = append(s.providerWarnings, trimmed)
	if len(s.providerWarnings) > defaultMonitoringEventLimit {
		s.providerWarnings = append([]string(nil), s.providerWarnings[len(s.providerWarnings)-defaultMonitoringEventLimit:]...)
	}
}

func (s *monitoringSession) reset(connectionID string, providerMode string) int64 {
	return s.resetAt(connectionID, providerMode, time.Now())
}

func (s *monitoringSession) resetAt(connectionID string, providerMode string, now time.Time) int64 {
	s.mu.Lock()
	defer s.mu.Unlock()

	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	s.generation++
	s.connectionID = connectionID
	s.providerMode = providerMode
	s.running = false
	s.points = nil
	s.recentGCEvents = nil
	s.availableMetrics = nil
	s.missingMetrics = nil
	s.providerWarnings = nil
	s.lastTouched = now
	return s.generation
}

func (s *monitoringSession) setCancel(cancel context.CancelFunc) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.cancel = cancel
}

func (s *monitoringSession) markRunning(generation int64) {
	s.markRunningAt(generation, time.Now())
}

func (s *monitoringSession) markRunningAt(generation int64, now time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return
	}
	s.running = true
	s.lastTouched = now
}

func (s *monitoringSession) markStopped(generation int64) bool {
	return s.markStoppedAt(generation, time.Now())
}

func (s *monitoringSession) markStoppedAt(generation int64, now time.Time) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if generation != s.generation {
		return false
	}
	s.running = false
	s.cancel = nil
	s.lastTouched = now
	return true
}

func (s *monitoringSession) stop() {
	s.stopAt(time.Now())
}

func (s *monitoringSession) stopAt(now time.Time) {
	s.mu.Lock()
	cancel := s.cancel
	s.cancel = nil
	s.generation++
	s.running = false
	s.lastTouched = now
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
}

func (s *monitoringSession) retentionState() (bool, time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.running, s.lastTouched
}

func resolveMonitoringConnectionID(cfg connection.ConnectionConfig) string {
	if trimmed := strings.TrimSpace(cfg.ID); trimmed != "" {
		return trimmed
	}
	host := strings.TrimSpace(cfg.Host)
	if host == "" {
		host = "unknown"
	}
	if cfg.Port > 0 {
		return fmt.Sprintf("%s:%d", host, cfg.Port)
	}
	return host
}

func cloneMonitoringPoint(point JVMMonitoringPoint) JVMMonitoringPoint {
	cloned := point
	cloned.ThreadStateCounts = cloneStringIntMap(point.ThreadStateCounts)
	return cloned
}

func cloneStringIntMap(input map[string]int) map[string]int {
	if len(input) == 0 {
		return nil
	}
	cloned := make(map[string]int, len(input))
	for key, value := range input {
		cloned[key] = value
	}
	return cloned
}
