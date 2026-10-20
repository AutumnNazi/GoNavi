package app

import (
	"sort"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/syncjob"
	"GoNavi-Wails/internal/taskrollback"
)

func shouldCreateTaskRollback(allowCreate, skip bool, taskID, database string) bool {
	return allowCreate && !skip && strings.TrimSpace(taskID) != "" && strings.TrimSpace(database) != ""
}

func dataSyncKindNeedsRollback(kind syncjob.JobKind) bool {
	switch kind {
	case syncjob.JobKindMigration, syncjob.JobKindReconcile, syncjob.JobKindQuerySink:
		return true
	default:
		return false
	}
}

func dataSyncRunShouldSnapshot(request syncjob.ExecutionRequest) bool {
	if request.Checkpoint != nil {
		return false
	}
	switch request.Run.Trigger {
	case syncjob.RunTriggerResume, syncjob.RunTriggerRetry:
		return false
	default:
		return true
	}
}

func dataSyncRunTerminal(status syncjob.RunStatus) bool {
	switch status {
	case syncjob.RunStatusSucceeded, syncjob.RunStatusPartial, syncjob.RunStatusFailed, syncjob.RunStatusCanceled, syncjob.RunStatusInterrupted:
		return true
	default:
		return false
	}
}

func dataSyncRollbackTableNames(dbType, database, schema string, mappings []syncjob.TableMapping) []string {
	seen := map[string]struct{}{}
	names := make([]string, 0, len(mappings))
	for _, mapping := range mappings {
		if !mapping.Enabled {
			continue
		}
		name := rollbackQualifiedTable(dbType, database, firstRollbackSchema(mapping.TargetSchema, schema), mapping.TargetTable)
		if name == "" {
			continue
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		names = append(names, name)
	}
	return names
}

func firstRollbackSchema(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func rollbackQualifiedTable(dbType, database, schema, table string) string {
	table = strings.TrimSpace(table)
	schema = strings.TrimSpace(schema)
	if table == "" || strings.Contains(table, ".") {
		return table
	}
	switch normalizeSQLClassifierDBType(dbType) {
	case "postgres", "kingbase", "highgo", "vastbase", "opengauss", "gaussdb", "oracle", "dameng", "sqlserver":
		if schema != "" && !strings.EqualFold(schema, strings.TrimSpace(database)) {
			return schema + "." + table
		}
	}
	return table
}

func selectRollbackObjects(config connection.ConnectionConfig, database string, catalog []taskrollback.Object, requested []string, whole bool) ([]taskrollback.Object, []string) {
	if whole {
		exportNames := make([]string, 0, len(catalog))
		for _, object := range catalog {
			if object.Existed && strings.TrimSpace(object.Name) != "" {
				exportNames = append(exportNames, object.Name)
			}
		}
		return append([]taskrollback.Object(nil), catalog...), exportNames
	}
	byFull := map[string]taskrollback.Object{}
	byPure := map[string][]taskrollback.Object{}
	for _, object := range catalog {
		full, pure := rollbackMatchKeys(config, database, object.Name)
		if full != "" {
			byFull[full] = object
		}
		if pure != "" {
			byPure[pure] = append(byPure[pure], object)
		}
	}
	objects := make([]taskrollback.Object, 0, len(requested))
	exportNames := make([]string, 0, len(requested))
	seen := map[string]struct{}{}
	for _, requestedName := range requested {
		requestedName = strings.TrimSpace(requestedName)
		if requestedName == "" {
			continue
		}
		full, pure := rollbackMatchKeys(config, database, requestedName)
		if full != "" {
			if _, ok := seen[full]; ok {
				continue
			}
			seen[full] = struct{}{}
		}
		if match, ok := byFull[full]; ok {
			objects = append(objects, match)
			exportNames = append(exportNames, match.Name)
			continue
		}
		if pure != "" && len(byPure[pure]) == 1 {
			objects = append(objects, byPure[pure][0])
			exportNames = append(exportNames, byPure[pure][0].Name)
			continue
		}
		objects = append(objects, taskrollback.Object{Name: requestedName, Existed: false})
	}
	return objects, exportNames
}

func rollbackObjectsToDrop(config connection.ConnectionConfig, database string, point taskrollback.Point, current []taskrollback.Object) []taskrollback.Object {
	drops := make([]taskrollback.Object, 0)
	if point.WholeDatabase {
		existed := map[string]struct{}{}
		for _, object := range point.Objects {
			if !object.Existed {
				continue
			}
			full, _ := rollbackMatchKeys(config, database, object.Name)
			if full != "" {
				existed[full] = struct{}{}
			}
		}
		for _, object := range current {
			full, _ := rollbackMatchKeys(config, database, object.Name)
			if _, ok := existed[full]; ok {
				continue
			}
			drops = append(drops, object)
		}
		return orderRollbackDrops(drops)
	}
	missingFull := map[string]struct{}{}
	missingPure := map[string]int{}
	for _, object := range point.Objects {
		if object.Existed {
			continue
		}
		full, pure := rollbackMatchKeys(config, database, object.Name)
		if full != "" {
			missingFull[full] = struct{}{}
		}
		if pure != "" {
			missingPure[pure]++
		}
	}
	for _, object := range current {
		full, pure := rollbackMatchKeys(config, database, object.Name)
		if _, ok := missingFull[full]; ok && full != "" {
			drops = append(drops, object)
			continue
		}
		if pure != "" && missingPure[pure] == 1 {
			drops = append(drops, object)
		}
	}
	return orderRollbackDrops(drops)
}

func orderRollbackDrops(objects []taskrollback.Object) []taskrollback.Object {
	views := make([]taskrollback.Object, 0)
	tables := make([]taskrollback.Object, 0)
	for _, object := range objects {
		if object.IsView {
			views = append(views, object)
			continue
		}
		tables = append(tables, object)
	}
	sort.Slice(views, func(i, j int) bool { return views[i].Name < views[j].Name })
	sort.Slice(tables, func(i, j int) bool { return tables[i].Name < tables[j].Name })
	return append(views, tables...)
}

func rollbackMatchKeys(config connection.ConnectionConfig, database, name string) (string, string) {
	full := normalizeExportObjectKey(config, database, name)
	_, pure := normalizeSchemaAndTableByType(resolveDDLDBType(config), database, name)
	return full, strings.ToLower(strings.TrimSpace(pure))
}

func taskRollbackForeignKeyGuard(dbType string) (string, string, bool) {
	switch normalizeSQLClassifierDBType(dbType) {
	case "mysql", "mariadb", "oceanbase", "diros", "starrocks", "sphinx":
		return "SET FOREIGN_KEY_CHECKS=0", "SET FOREIGN_KEY_CHECKS=1", true
	default:
		return "", "", false
	}
}
