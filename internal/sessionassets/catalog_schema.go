package sessionassets

// catalogMigrations 按目标版本存放迁移语句。版本 1 是初始 schema：
// integrations.kind 唯一约束实现每数据根每工具单一入口（S-04）；
// assets 上 (integration_id, native_thread_id) 唯一约束实现同工具内
// 同一原始历史的幂等纳入；suppressed_sources 承载用户删除后的抑制标记，
// 防止扫描自动重新纳入（FR-20）。
var catalogMigrations = map[int][]string{
	1: {
		`CREATE TABLE IF NOT EXISTS integrations (
			id           TEXT PRIMARY KEY,
			kind         TEXT NOT NULL,
			display_name TEXT NOT NULL DEFAULT '',
			enabled      INTEGER NOT NULL DEFAULT 0,
			created_at   INTEGER NOT NULL DEFAULT 0,
			updated_at   INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_session_assets_integrations_kind
			ON integrations(kind)`,
		`CREATE TABLE IF NOT EXISTS sources (
			id             TEXT PRIMARY KEY,
			integration_id TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
			kind           TEXT NOT NULL DEFAULT '',
			display_name   TEXT NOT NULL DEFAULT '',
			root_path      TEXT NOT NULL,
			identity_key   TEXT NOT NULL,
			enabled        INTEGER NOT NULL DEFAULT 1,
			last_checked_at INTEGER NOT NULL DEFAULT 0,
			created_at     INTEGER NOT NULL DEFAULT 0,
			updated_at     INTEGER NOT NULL DEFAULT 0,
			UNIQUE(integration_id, identity_key)
		)`,
		`CREATE TABLE IF NOT EXISTS assets (
			id                    TEXT PRIMARY KEY,
			integration_id        TEXT NOT NULL REFERENCES integrations(id) ON DELETE CASCADE,
			native_thread_id      TEXT NOT NULL DEFAULT '',
			title                 TEXT NOT NULL DEFAULT '',
			project_dir           TEXT NOT NULL DEFAULT '',
			provider              TEXT NOT NULL DEFAULT '',
			model                 TEXT NOT NULL DEFAULT '',
			created_at            INTEGER NOT NULL DEFAULT 0,
			updated_at            INTEGER NOT NULL DEFAULT 0,
			first_seen_at         INTEGER NOT NULL DEFAULT 0,
			last_seen_at          INTEGER NOT NULL DEFAULT 0,
			fork_parent_thread_id TEXT NOT NULL DEFAULT '',
			backup_status         TEXT NOT NULL DEFAULT 'none',
			material_status       TEXT NOT NULL DEFAULT 'not_prepared',
			latest_generation_id  TEXT NOT NULL DEFAULT '',
			latest_complete       INTEGER NOT NULL DEFAULT 0,
			last_backup_at        INTEGER NOT NULL DEFAULT 0,
			deleted               INTEGER NOT NULL DEFAULT 0,
			cleanup_error         TEXT NOT NULL DEFAULT '',
			UNIQUE(integration_id, native_thread_id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_session_assets_integration_updated
			ON assets(integration_id, updated_at)`,
		`CREATE TABLE IF NOT EXISTS source_refs (
			asset_id      TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
			source_id     TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
			native_path   TEXT NOT NULL DEFAULT '',
			source_status TEXT NOT NULL DEFAULT 'unknown',
			last_seen_at  INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (asset_id, source_id)
		)`,
		`CREATE TABLE IF NOT EXISTS capture_jobs (
			id                 TEXT PRIMARY KEY,
			asset_id           TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
			source_id          TEXT NOT NULL DEFAULT '',
			trigger_kind       TEXT NOT NULL DEFAULT '',
			status             TEXT NOT NULL DEFAULT 'queued',
			base_generation_id TEXT NOT NULL DEFAULT '',
			generation_id      TEXT NOT NULL DEFAULT '',
			attempt            INTEGER NOT NULL DEFAULT 0,
			error              TEXT NOT NULL DEFAULT '',
			request_json       TEXT NOT NULL DEFAULT '{}',
			created_at         INTEGER NOT NULL DEFAULT 0,
			updated_at         INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE INDEX IF NOT EXISTS idx_session_assets_capture_jobs_asset
			ON capture_jobs(asset_id, created_at)`,
		`CREATE INDEX IF NOT EXISTS idx_session_assets_capture_jobs_status
			ON capture_jobs(status, created_at)`,
		`CREATE TABLE IF NOT EXISTS handoff_records (
			id           TEXT PRIMARY KEY,
			asset_id     TEXT NOT NULL,
			kind         TEXT NOT NULL DEFAULT '',
			payload_json TEXT NOT NULL DEFAULT '{}',
			created_at   INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS suppressed_sources (
			integration_id  TEXT NOT NULL,
			native_thread_id TEXT NOT NULL,
			reason          TEXT NOT NULL DEFAULT 'user_delete',
			created_at      INTEGER NOT NULL DEFAULT 0,
			PRIMARY KEY (integration_id, native_thread_id)
		)`,
	},
	// 版本 2：source_refs 记录上次观测的源文件版本（大小/修改时间），
	// 重归档判断比较源版本而不是扫描时间（P0-03/FR-07/V-09）。
	2: {
		`ALTER TABLE source_refs ADD COLUMN source_size INTEGER NOT NULL DEFAULT 0`,
		`ALTER TABLE source_refs ADD COLUMN source_mtime INTEGER NOT NULL DEFAULT 0`,
	},
}
