package db

import (
	"errors"
	"strings"
	"unicode/utf8"

	"GoNavi-Wails/internal/connection"
)

type pluginDatabaseConfig struct {
	Host             string `json:"host"`
	Port             int    `json:"port"`
	User             string `json:"user"`
	Password         string `json:"password"`
	Database         string `json:"database"`
	ConnectionParams string `json:"connectionParams"`
}

func (p *PluginDatabase) projectConfig(config connection.ConnectionConfig) (pluginDatabaseConfig, error) {
	if config.Type != p.connectionType {
		return pluginDatabaseConfig{}, errors.New("plugin database connection type mismatch")
	}
	if err := rejectPluginConnectionExtras(config); err != nil {
		return pluginDatabaseConfig{}, err
	}
	if config.Port < 0 || config.Port > 65535 || config.Timeout < 0 || config.Timeout > 3600 || config.QueryTimeout < 0 || config.QueryTimeout > 86400 {
		return pluginDatabaseConfig{}, errors.New("plugin database connection limits are invalid")
	}
	database := config.Database
	if config.HasRuntimeDatabaseOverride() {
		database = config.RuntimeDatabaseOverride()
	}
	for _, value := range []string{config.Host, config.User, database} {
		if !validPluginDatabaseText(value, pluginDatabaseMaxName, false) {
			return pluginDatabaseConfig{}, errors.New("plugin database connection field exceeds limits")
		}
	}
	for _, value := range []string{config.Password, config.ConnectionParams} {
		if !validPluginDatabaseText(value, pluginDatabaseMaxText, false) {
			return pluginDatabaseConfig{}, errors.New("plugin database credential or parameter exceeds limits")
		}
	}
	return pluginDatabaseConfig{Host: config.Host, Port: config.Port, User: config.User, Password: config.Password,
		Database: database, ConnectionParams: config.ConnectionParams}, nil
}

func rejectPluginConnectionExtras(config connection.ConnectionConfig) error {
	if config.UseSSH || config.UseProxy || config.UseHTTPTunnel {
		return errors.New("plugin database transport tunnels and proxies are unsupported")
	}
	if config.UseSSL || (config.SSLMode != "" && config.SSLMode != "disable") || config.SSLCAPath != "" || config.SSLCertPath != "" || config.SSLKeyPath != "" {
		return errors.New("plugin database host TLS configuration is unsupported")
	}
	if config.Driver != "" || config.DSN != "" || config.URI != "" || (config.DriverVariant != "" && config.DriverVariant != "auto") {
		return errors.New("plugin database custom drivers and connection URIs are unsupported")
	}
	if len(config.Hosts) != 0 || (config.Topology != "" && config.Topology != "single") || config.ReplicaSet != "" {
		return errors.New("plugin database multi-host topology is unsupported")
	}
	if config.JVM.JMX.Enabled || config.JVM.Endpoint.Enabled || config.JVM.Agent.Enabled || config.JVM.Diagnostic.Enabled {
		return errors.New("plugin database JVM transports are unsupported")
	}
	return nil
}

func validPluginDatabaseText(value string, limit int, required bool) bool {
	return (!required || value != "") && len(value) <= limit && utf8.ValidString(value) && !strings.ContainsRune(value, 0)
}
