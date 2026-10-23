package db

import (
	"strconv"

	"GoNavi-Wails/internal/connection"
)

func validatePluginColumns(columns []connection.ColumnDefinition) error {
	seen := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		if !validPluginDatabaseText(column.Name, pluginDatabaseMaxName, true) || !validPluginDatabaseText(column.Type, 4096, true) {
			return ErrPluginDatabaseProtocol
		}
		if column.Nullable != "YES" && column.Nullable != "NO" {
			return ErrPluginDatabaseProtocol
		}
		if column.Key != "" && column.Key != "PRI" && column.Key != "UNI" && column.Key != "MUL" {
			return ErrPluginDatabaseProtocol
		}
		if !validPluginDatabaseText(column.Extra, 4096, false) || !validPluginDatabaseText(column.Comment, pluginDatabaseMaxText, false) {
			return ErrPluginDatabaseProtocol
		}
		if !validPluginDatabaseText(column.Charset, 256, false) || !validPluginDatabaseText(column.Collation, 256, false) {
			return ErrPluginDatabaseProtocol
		}
		if column.Default != nil && !validPluginDatabaseText(*column.Default, pluginDatabaseMaxText, false) {
			return ErrPluginDatabaseProtocol
		}
		if _, duplicate := seen[column.Name]; duplicate {
			return ErrPluginDatabaseProtocol
		}
		seen[column.Name] = struct{}{}
	}
	return nil
}

func validatePluginAllColumns(columns []connection.ColumnDefinitionWithTable) error {
	seen := make(map[string]struct{}, len(columns))
	for _, column := range columns {
		if !validPluginDatabaseText(column.TableName, pluginDatabaseMaxName, true) || !validPluginDatabaseText(column.Name, pluginDatabaseMaxName, true) || !validPluginDatabaseText(column.Type, 4096, true) || !validPluginDatabaseText(column.Comment, pluginDatabaseMaxText, false) {
			return ErrPluginDatabaseProtocol
		}
		key := column.TableName + "\x00" + column.Name
		if _, duplicate := seen[key]; duplicate {
			return ErrPluginDatabaseProtocol
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validatePluginIndexes(indexes []connection.IndexDefinition) error {
	seen := make(map[string]struct{}, len(indexes))
	for _, index := range indexes {
		if !validPluginDatabaseText(index.Name, pluginDatabaseMaxName, true) || !validPluginDatabaseText(index.ColumnName, pluginDatabaseMaxName, true) || !validPluginDatabaseText(index.IndexType, 256, true) {
			return ErrPluginDatabaseProtocol
		}
		if (index.NonUnique != 0 && index.NonUnique != 1) || index.SeqInIndex < 1 || index.SeqInIndex > pluginDatabaseMaxFields || index.SubPart < 0 {
			return ErrPluginDatabaseProtocol
		}
		key := index.Name + "\x00" + strconv.Itoa(index.SeqInIndex)
		if _, duplicate := seen[key]; duplicate {
			return ErrPluginDatabaseProtocol
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validatePluginForeignKeys(keys []connection.ForeignKeyDefinition) error {
	seen := make(map[string]struct{}, len(keys))
	for _, foreignKey := range keys {
		for _, name := range []string{foreignKey.Name, foreignKey.ColumnName, foreignKey.RefTableName, foreignKey.RefColumnName, foreignKey.ConstraintName} {
			if !validPluginDatabaseText(name, pluginDatabaseMaxName, true) {
				return ErrPluginDatabaseProtocol
			}
		}
		key := foreignKey.ConstraintName + "\x00" + foreignKey.ColumnName
		if _, duplicate := seen[key]; duplicate {
			return ErrPluginDatabaseProtocol
		}
		seen[key] = struct{}{}
	}
	return nil
}

func validatePluginTriggers(triggers []connection.TriggerDefinition) error {
	seen := make(map[string]struct{}, len(triggers))
	for _, trigger := range triggers {
		if !validPluginDatabaseText(trigger.Name, pluginDatabaseMaxName, true) || !validPluginDatabaseText(trigger.Statement, pluginDatabaseMaxQuery, true) {
			return ErrPluginDatabaseProtocol
		}
		if trigger.Timing != "BEFORE" && trigger.Timing != "AFTER" && trigger.Timing != "INSTEAD OF" {
			return ErrPluginDatabaseProtocol
		}
		if trigger.Event != "INSERT" && trigger.Event != "UPDATE" && trigger.Event != "DELETE" && trigger.Event != "TRUNCATE" {
			return ErrPluginDatabaseProtocol
		}
		if trigger.Orientation != "" && trigger.Orientation != "ROW" && trigger.Orientation != "STATEMENT" {
			return ErrPluginDatabaseProtocol
		}
		key := trigger.Name + "\x00" + trigger.Event + "\x00" + trigger.Timing
		if _, duplicate := seen[key]; duplicate {
			return ErrPluginDatabaseProtocol
		}
		seen[key] = struct{}{}
	}
	return nil
}
