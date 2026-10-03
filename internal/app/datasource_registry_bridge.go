package app

import (
	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

// app 层对数据源描述表的读取入口。各处历史分支先判断旧类型，未命中时回落到这里，
// 新数据源因此只需在 internal/datasource/datasources.json 声明一次。

// resolveExplainDBType 选择执行计划的方言解析器。描述表类型按自身类型名分发：
// 它们的计划格式通常与兼容协议的母方言不同（例如 TiDB 走 MySQL 协议但不支持 FORMAT=JSON）。
func resolveExplainDBType(config connection.ConnectionConfig) string {
	if spec, ok := db.DataSourceSpec(config.Type); ok {
		return spec.Type
	}
	return resolveDDLDBType(config)
}

// registryDefaultPort 返回描述表类型的默认端口。
func registryDefaultPort(driverType string) (int, bool) {
	spec, ok := db.DataSourceSpec(driverType)
	if !ok {
		return 0, false
	}
	return spec.DefaultPort, true
}

// registryObjectKind 返回描述表类型在导航树里“表”节点的对象名词。
func registryObjectKind(driverType string) (string, bool) {
	spec, ok := db.DataSourceSpec(driverType)
	if !ok || spec.ObjectKind == "" {
		return "", false
	}
	return spec.ObjectKind, true
}

// registryIdentifiersCaseSensitive 返回描述表类型的对象标识符是否区分大小写。
func registryIdentifiersCaseSensitive(driverType string) (bool, bool) {
	spec, ok := db.DataSourceSpec(driverType)
	if !ok {
		return false, false
	}
	return spec.CaseSensitiveIdentifiers, true
}

// registryProtectionSupported 返回描述表类型是否接入只读/生产保护。
func registryProtectionSupported(driverType string) bool {
	spec, ok := db.DataSourceSpec(driverType)
	return ok && spec.Protection
}

// registryDBNameSelectsDatabase 报告导航树选中的库名是否应写入连接配置的 Database。
func registryDBNameSelectsDatabase(driverType string) bool {
	spec, ok := db.DataSourceSpec(driverType)
	return ok && !spec.SyntheticDatabase
}

// registryUsesDriverProxy 报告描述表类型是否由驱动自己处理连接代理（不在主进程改写为本地转发地址）。
func registryUsesDriverProxy(driverType string) bool {
	spec, ok := db.DataSourceSpec(driverType)
	return ok && spec.UsesDriverProxy()
}
