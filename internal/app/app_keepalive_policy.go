package app

import (
	"time"

	"GoNavi-Wails/internal/connection"
)

// connectionKeepAlivePolicy 是一条连接当前应采用的保活设置；从 app.go 拆出，逻辑未改。
type connectionKeepAlivePolicy struct {
	enabled  bool
	interval time.Duration
	sql      string
	dbType   string
}

func resolveConnectionKeepAlivePolicy(config connection.ConnectionConfig) connectionKeepAlivePolicy {
	enabled, interval := resolveConnectionKeepAliveSettings(config)
	sql, dbType := resolveConnectionKeepAliveSQL(config)
	return connectionKeepAlivePolicy{
		enabled:  enabled,
		interval: interval,
		sql:      sql,
		dbType:   dbType,
	}
}

func (policy connectionKeepAlivePolicy) matches(entry cachedDatabase) bool {
	return entry.keepAliveEnabled == policy.enabled &&
		entry.keepAliveInterval == policy.interval &&
		entry.keepAliveSQL == policy.sql &&
		entry.keepAliveDBType == policy.dbType
}

func (policy connectionKeepAlivePolicy) apply(entry cachedDatabase, now time.Time) cachedDatabase {
	if policy.matches(entry) {
		return entry
	}
	wasKeepAliveEnabled := entry.keepAliveEnabled
	entry.keepAliveRevision = nextConnectionKeepAliveRevision(entry.keepAliveRevision)
	entry.keepAliveEnabled = policy.enabled
	entry.keepAliveInterval = policy.interval
	entry.keepAliveSQL = policy.sql
	entry.keepAliveDBType = policy.dbType
	if !policy.enabled {
		entry.keepAliveInFlight = false
		entry.keepAliveInFlightRevision = 0
		entry.lastKeepAliveAt = time.Time{}
	} else if !wasKeepAliveEnabled || entry.lastKeepAliveAt.IsZero() {
		entry.lastKeepAliveAt = now
	}
	return entry
}
