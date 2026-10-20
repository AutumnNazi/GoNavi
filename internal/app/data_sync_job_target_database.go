package app

import (
	"context"
	"fmt"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/syncjob"
)

// 目标库的存在性与自动创建。
//
// 同步任务能自动建表，但表总要落在某个库里：目标库没选时，MySQL 系的每条元数据
// 查询都会报 1046 No database selected；选了一个还不存在的库时，连库就会失败。
// 这里在预检阶段把这两种情况收敛成一条可读的结论，并在任务运行前补建目标库。

// dataSyncTargetDatabaseCreatable 报告该目标类型能否由同步任务自动建库。
//
// 只收录 buildCreateDatabaseQuery 真正以「库」为单位建出物理容器的方言；
// Oracle/达梦的库等同用户，Sphinx 不支持建库，其余类型的 Database 字段语义各异，
// 一律不自动创建，保持原行为。
func dataSyncTargetDatabaseCreatable(config connection.ConnectionConfig) bool {
	switch resolveDDLDBType(config) {
	case "mysql", "mariadb", "diros", "oceanbase", "starrocks", "tdengine", "clickhouse",
		"postgres", "kingbase", "highgo", "vastbase", "opengauss", "gaussdb", "sqlserver":
		return true
	default:
		return false
	}
}

// dataSyncTargetDatabaseRequired 报告目标端是否必须落定一个库才能读写表。
//
// MySQL 系在连接未指定库时不会回落到默认库，任何不带库名的表查询都会报 1046；
// PG 系、SQL Server、ClickHouse 都有默认库，不在此列。
func dataSyncTargetDatabaseRequired(config connection.ConnectionConfig) bool {
	switch resolveDDLDBType(config) {
	case "mysql", "mariadb", "diros", "oceanbase", "starrocks":
		return true
	default:
		return false
	}
}

// dataSyncJobMayCreateDatabase 报告任务是否允许补建目标库：
// 只有至少一张表允许自动建表时，建一个空库才有意义。
func dataSyncJobMayCreateDatabase(definition syncjob.JobDefinition) bool {
	if !dataSyncJobCreatesTargets(definition) {
		return false
	}
	if definition.Kind == syncjob.JobKindMigration {
		return true
	}
	for _, mapping := range definition.Mappings {
		if !mapping.Enabled {
			continue
		}
		strategy := firstNonEmptySyncJob(mapping.TargetTableStrategy, definition.Options.TargetTableStrategy)
		if strategy != "" && strategy != "existing_only" {
			return true
		}
	}
	return false
}

// dataSyncServerLevelConfig 返回不绑定具体库的连接配置，用于列库与建库。
func dataSyncServerLevelConfig(config connection.ConnectionConfig) connection.ConnectionConfig {
	runConfig := config
	runConfig.Database = ""
	if resolveDDLDBType(config) == "clickhouse" && strings.EqualFold(strings.TrimSpace(config.Type), "custom") {
		runConfig = runConfig.WithRuntimeDatabaseOverride("")
	}
	return runConfig
}

// dataSyncTargetDatabaseExists 检查目标库是否存在。
//
// checked 为 false 表示无法判定（类型不支持、列库失败等），调用方必须按「存在」
// 处理：判定失败不应凭空拦住原本能跑的任务，真正的连接错误会在后续步骤照常暴露。
func (a *App) dataSyncTargetDatabaseExists(ctx context.Context, config connection.ConnectionConfig, database string) (exists bool, checked bool) {
	database = strings.TrimSpace(database)
	if database == "" || !dataSyncTargetDatabaseCreatable(config) {
		return false, false
	}
	if ctx == nil {
		ctx = context.Background()
	}
	dbInst, err := a.getDatabaseWithContext(ctx, normalizeRunConfig(dataSyncServerLevelConfig(config), ""), false)
	if err != nil || ctx.Err() != nil {
		return false, false
	}
	names, err := dbInst.GetDatabases()
	// 空清单通常是账号看不到库清单，而不是服务器上一个库都没有，不能据此断定缺库。
	if err != nil || len(names) == 0 {
		return false, false
	}
	for _, name := range names {
		if strings.EqualFold(strings.TrimSpace(name), database) {
			return true, true
		}
	}
	return false, true
}

// dataSyncTargetDatabaseMissing 仅在确认目标库不存在时返回 true。
func (a *App) dataSyncTargetDatabaseMissing(ctx context.Context, config connection.ConnectionConfig, database string) bool {
	exists, checked := a.dataSyncTargetDatabaseExists(ctx, config, database)
	return checked && !exists
}

// preflightDataSyncTargetDatabaseIssues 在连目标端之前校验目标库。
// 对比与查询写入任务只读写已有对象，不在这里判定。
func (a *App) preflightDataSyncTargetDatabaseIssues(ctx context.Context, definition syncjob.JobDefinition, target *resolvedDataSyncJobEndpoint) []DataSyncJobPreflightIssue {
	if definition.Kind == syncjob.JobKindCompare || definition.Kind == syncjob.JobKindQuerySink {
		return nil
	}
	return a.preflightDataSyncTargetDatabase(ctx, definition, target)
}

// dataSyncPreflightTargetRunConfig 返回预检连目标端用的配置。
// 目标库待创建时只能连到服务器层，否则 Ping 会因库不存在而失败。
func dataSyncPreflightTargetRunConfig(target resolvedDataSyncJobEndpoint) connection.ConnectionConfig {
	if target.DatabasePending {
		return normalizeRunConfig(dataSyncServerLevelConfig(target.Config), "")
	}
	return normalizeMetadataRunConfig(target.Config, target.Database)
}

// preflightDataSyncTargetDatabase 校验目标库，并在库尚不存在时把 target 标记为待创建。
//
// 待创建的目标库上不能连库、不能查表：映射校验据此把每张表视为「不存在」，
// 交给迁移规划器建表，而不是逐表报连接失败。
func (a *App) preflightDataSyncTargetDatabase(ctx context.Context, definition syncjob.JobDefinition, target *resolvedDataSyncJobEndpoint) []DataSyncJobPreflightIssue {
	if target == nil {
		return nil
	}
	selected := strings.TrimSpace(target.Database)
	if selected == "" {
		if dataSyncTargetDatabaseRequired(target.Config) && strings.TrimSpace(target.Config.Database) == "" {
			return []DataSyncJobPreflightIssue{preflightIssue("target_database_required", DataSyncJobPreflightBlocker, "endpoints", "target database is not selected", "")}
		}
		return nil
	}
	if !a.dataSyncTargetDatabaseMissing(ctx, target.Config, selected) {
		return nil
	}
	if !dataSyncJobMayCreateDatabase(definition) {
		return []DataSyncJobPreflightIssue{preflightIssue("target_database_missing", DataSyncJobPreflightBlocker, "endpoints", fmt.Sprintf("target database %s does not exist", selected), "")}
	}
	if err := ensureConnectionAllowsStructureEdit(target.Config, "connection.backend.action.create_database"); err != nil {
		return []DataSyncJobPreflightIssue{preflightIssue("target_protection_blocked", DataSyncJobPreflightBlocker, "endpoints", err.Error(), "")}
	}
	target.DatabasePending = true
	return []DataSyncJobPreflightIssue{preflightIssue("target_database_will_be_created", DataSyncJobPreflightInfo, "endpoints", fmt.Sprintf("target database %s will be created before migration", selected), "")}
}

// ensureDataSyncTargetDatabase 在任务运行前补建缺失的目标库。
//
// 复用 CreateDatabase：只读/生产保护、SQL 审计与元数据缓存失效都在那里，
// 这里不另写一套建库路径。
func (a *App) ensureDataSyncTargetDatabase(ctx context.Context, definition syncjob.JobDefinition, target resolvedDataSyncJobEndpoint) error {
	if !dataSyncJobMayCreateDatabase(definition) {
		return nil
	}
	database := strings.TrimSpace(target.Database)
	if !a.dataSyncTargetDatabaseMissing(ctx, target.Config, database) {
		return nil
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	result := a.CreateDatabase(target.Config, database, "", "")
	if !result.Success {
		return fmt.Errorf("create target database %s: %s", database, result.Message)
	}
	return nil
}
