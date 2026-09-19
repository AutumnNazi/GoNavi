package app

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
)

// DuckDB 保存连接附加指令：由本层拦截执行，绝不进入 DuckDB 解析器，
// 用户 SQL 全程不出现账号、密码或 DSN（issue #1270）。
type duckDBAttachDirectiveKind int

const (
	duckDBAttachDirectiveKindAttach duckDBAttachDirectiveKind = iota
	duckDBAttachDirectiveKindDetach
)

type duckDBAttachDirective struct {
	kind     duckDBAttachDirectiveKind
	ref      string // ATTACH：连接 ID 或名称
	alias    string // ATTACH 可空（默认按名称派生）；DETACH 必填
	readOnly bool   // ATTACH 默认只读
}

var (
	duckDBAttachIdentifierPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)
	duckDBAttachBarewordPattern   = regexp.MustCompile(`^[A-Za-z0-9_.:-]+$`)
)

// parseDuckDBSavedConnectionDirective 判断一条语句是否为附加/卸载指令。
// 第二个返回值为 false 表示不是指令（原样执行）；true 但带错误表示语句以
// 指令开头但格式非法，应向用户报错而不是静默透传。
func parseDuckDBSavedConnectionDirective(statement string) (*duckDBAttachDirective, bool, error) {
	trimmed := strings.TrimSpace(statement)
	trimmed = strings.TrimSuffix(trimmed, ";")
	trimmed = strings.TrimSpace(trimmed)
	upper := strings.ToUpper(trimmed)
	switch {
	case strings.HasPrefix(upper, "ATTACH SAVED CONNECTION"):
		return parseDuckDBAttachDirectiveBody(strings.TrimSpace(trimmed[len("ATTACH SAVED CONNECTION"):]))
	case strings.HasPrefix(upper, "DETACH SAVED CONNECTION"):
		return parseDuckDBDetachDirectiveBody(strings.TrimSpace(trimmed[len("DETACH SAVED CONNECTION"):]))
	default:
		return nil, false, nil
	}
}

func parseDuckDBAttachDirectiveBody(body string) (*duckDBAttachDirective, bool, error) {
	if body == "" {
		return nil, true, errors.New("缺少连接引用")
	}
	ref, rest, err := consumeDuckDBAttachRef(body)
	if err != nil {
		return nil, true, err
	}
	directive := &duckDBAttachDirective{kind: duckDBAttachDirectiveKindAttach, ref: ref, readOnly: true}

	rest = strings.TrimSpace(rest)
	if rest == "" {
		return directive, true, nil
	}
	// 可选 AS <alias>
	if len(rest) >= 3 && strings.EqualFold(rest[:2], "AS") && (rest[2] == ' ' || rest[2] == '\t') {
		aliasPart := strings.TrimSpace(rest[3:])
		parts := strings.Fields(aliasPart)
		if len(parts) == 0 || !duckDBAttachIdentifierPattern.MatchString(parts[0]) {
			return nil, true, errors.New("AS 后需要合法别名（字母或下划线开头）")
		}
		directive.alias = parts[0]
		rest = strings.TrimSpace(strings.Join(parts[1:], " "))
		if rest == "" {
			return directive, true, nil
		}
	}
	// 可选 READ ONLY / READ WRITE（兼容连写与下划线写法）
	mode := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(rest, "_", " "), "  ", " "))
	switch strings.ReplaceAll(mode, " ", "") {
	case "READONLY":
		directive.readOnly = true
	case "READWRITE":
		directive.readOnly = false
	default:
		return nil, true, fmt.Errorf("无法识别的子句 %q", rest)
	}
	return directive, true, nil
}

func parseDuckDBDetachDirectiveBody(body string) (*duckDBAttachDirective, bool, error) {
	if body == "" {
		return nil, true, errors.New("缺少要卸载的别名")
	}
	fields := strings.Fields(body)
	if len(fields) != 1 || !duckDBAttachIdentifierPattern.MatchString(fields[0]) {
		return nil, true, errors.New("卸载语句需要单个合法别名")
	}
	return &duckDBAttachDirective{kind: duckDBAttachDirectiveKindDetach, alias: fields[0]}, true, nil
}

// consumeDuckDBAttachRef 读取连接引用：单引号字符串（成对单引号转义）或无空格裸词。
func consumeDuckDBAttachRef(body string) (string, string, error) {
	if body == "" {
		return "", "", errors.New("缺少连接引用")
	}
	if body[0] == '\'' {
		var builder strings.Builder
		for i := 1; i < len(body); i++ {
			switch body[i] {
			case '\'':
				if i+1 < len(body) && body[i+1] == '\'' {
					builder.WriteByte('\'')
					i++
					continue
				}
				return builder.String(), body[i+1:], nil
			default:
				builder.WriteByte(body[i])
			}
		}
		return "", "", errors.New("连接引用的引号未闭合")
	}
	end := 0
	for end < len(body) && body[end] != ' ' && body[end] != '\t' {
		end++
	}
	ref := body[:end]
	if !duckDBAttachBarewordPattern.MatchString(ref) {
		return "", "", errors.New("含空格的连接名称需要用单引号包裹")
	}
	return ref, body[end:], nil
}

// slugifyAttachAlias 从连接名称派生默认别名：非法字符折叠为下划线；
// 不以字母/下划线开头或结果为空时加前缀，保证是合法标识符。
func slugifyAttachAlias(name string, connectionID string) string {
	var builder strings.Builder
	lastUnderscore := false
	for _, r := range strings.TrimSpace(name) {
		if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			builder.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if r == '_' {
			builder.WriteRune('_')
			lastUnderscore = true
			continue
		}
		if !lastUnderscore && builder.Len() > 0 {
			builder.WriteRune('_')
			lastUnderscore = true
		}
	}
	slug := strings.Trim(builder.String(), "_")
	if !duckDBAttachIdentifierPattern.MatchString(slug) {
		prefix := "saved_db"
		if trimmedID := strings.TrimSpace(connectionID); trimmedID != "" {
			sanitizedID := strings.Map(func(r rune) rune {
				if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
					return r
				}
				return '_'
			}, trimmedID)
			prefix = "saved_db_" + sanitizedID[:min(len(sanitizedID), 8)]
		}
		slug = prefix
	}
	return slug
}

// resolveSavedConnectionForAttach 按“ID 权威、名称便利”解析保存连接：
// 先精确匹配 ID，再匹配唯一名称；重名报错并列出候选（含 ID）。
func (a *App) resolveSavedConnectionForAttach(ref string) (connection.SavedConnectionView, error) {
	trimmed := strings.TrimSpace(ref)
	if trimmed == "" {
		return connection.SavedConnectionView{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.connection_not_found", map[string]any{"ref": ref}))
	}
	views, err := a.savedConnectionRepository().List()
	if err != nil {
		return connection.SavedConnectionView{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.repository_unavailable", map[string]any{"detail": err.Error()}))
	}
	for _, view := range views {
		if strings.TrimSpace(view.ID) == trimmed {
			return view, nil
		}
	}
	var candidates []connection.SavedConnectionView
	for _, view := range views {
		if strings.TrimSpace(view.Name) == trimmed {
			candidates = append(candidates, view)
		}
	}
	switch len(candidates) {
	case 1:
		return candidates[0], nil
	case 0:
		return connection.SavedConnectionView{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.connection_not_found", map[string]any{"ref": trimmed}))
	default:
		var labels []string
		for _, view := range candidates {
			labels = append(labels, fmt.Sprintf("%s（%s，ID: %s）", strings.TrimSpace(view.Name), view.Config.Type, view.ID))
		}
		return connection.SavedConnectionView{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.connection_ambiguous", map[string]any{
			"ref":        trimmed,
			"count":      len(candidates),
			"candidates": strings.Join(labels, "、"),
		}))
	}
}

// buildDuckDBAttachSpec 把解析后的保存连接映射为驱动附加参数。
// 隧道连接与不支持的类型在此显式报错，绝不把凭据带给无法安全承载它们的链路。
func (a *App) buildDuckDBAttachSpec(view connection.SavedConnectionView, resolved connection.ConnectionConfig, alias string, readOnly bool) (db.ExternalAttachSpec, error) {
	name := strings.TrimSpace(view.Name)
	if resolved.UseSSH && strings.TrimSpace(resolved.SSH.Host) != "" {
		return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.tunnel_unsupported", map[string]any{"name": name}))
	}
	if strings.TrimSpace(resolved.Proxy.Type) != "" && strings.TrimSpace(resolved.Proxy.Host) != "" {
		return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.tunnel_unsupported", map[string]any{"name": name}))
	}
	if strings.TrimSpace(resolved.HTTPTunnel.Host) != "" {
		return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.tunnel_unsupported", map[string]any{"name": name}))
	}
	if !readOnly && resolved.ReadOnly {
		return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.read_write_rejected", map[string]any{"name": name}))
	}

	finalAlias := strings.TrimSpace(alias)
	if finalAlias == "" {
		finalAlias = slugifyAttachAlias(name, view.ID)
	}
	spec := db.ExternalAttachSpec{
		Alias:      finalAlias,
		ReadOnly:   readOnly,
		SecretName: "gonavi_attach_" + finalAlias,
	}
	switch strings.ToLower(strings.TrimSpace(resolved.Type)) {
	case "mysql", "mariadb":
		spec.Kind = db.ExternalAttachKindMySQL
		spec.Host = strings.TrimSpace(resolved.Host)
		spec.Port = resolved.Port
		spec.User = strings.TrimSpace(resolved.User)
		spec.Password = resolved.Password
		spec.Database = strings.TrimSpace(resolved.Database)
	case "oceanbase":
		if strings.EqualFold(strings.TrimSpace(resolved.OceanBaseProtocol), "oracle") {
			return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.type_unsupported", map[string]any{"name": name, "type": resolved.Type}))
		}
		spec.Kind = db.ExternalAttachKindMySQL
		spec.Host = strings.TrimSpace(resolved.Host)
		spec.Port = resolved.Port
		spec.User = strings.TrimSpace(resolved.User)
		spec.Password = resolved.Password
		spec.Database = strings.TrimSpace(resolved.Database)
	case "postgres", "kingbase", "opengauss", "gaussdb", "vastbase", "highgo":
		spec.Kind = db.ExternalAttachKindPostgres
		spec.Host = strings.TrimSpace(resolved.Host)
		spec.Port = resolved.Port
		spec.User = strings.TrimSpace(resolved.User)
		spec.Password = resolved.Password
		spec.Database = strings.TrimSpace(resolved.Database)
	case "sqlite":
		spec.Kind = db.ExternalAttachKindSQLite
		spec.FilePath = strings.TrimSpace(firstNonEmpty(resolved.Host, resolved.Database))
		if spec.FilePath == "" || spec.FilePath == ":memory:" {
			return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.sqlite_memory_unsupported", map[string]any{"name": name}))
		}
	case "duckdb":
		spec.Kind = db.ExternalAttachKindDuckDB
		spec.FilePath = strings.TrimSpace(firstNonEmpty(resolved.Host, resolved.Database))
		if spec.FilePath == "" || spec.FilePath == ":memory:" {
			return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.sqlite_memory_unsupported", map[string]any{"name": name}))
		}
	default:
		return db.ExternalAttachSpec{}, fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.type_unsupported", map[string]any{"name": name, "type": resolved.Type}))
	}
	return spec, nil
}

// applyDuckDBSavedConnectionDirectives 在语句级扫描 DuckDB 查询：附加/卸载指令
// 由本层执行，改写为一条返回执行结果的合成 SELECT 交给后续管道；其余语句原样保留。
// 返回改写后的查询文本；无指令时原样返回。
func (a *App) applyDuckDBSavedConnectionDirectives(ctx context.Context, dbInst db.Database, query string) (string, error) {
	statements := splitSQLStatementsForDialect("duckdb", query)
	if len(statements) == 0 {
		return query, nil
	}
	var attacher db.ExternalDatabaseAttacher
	var rewritten []string
	directiveSeen := false
	for _, statement := range statements {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		directive, isDirective, parseErr := parseDuckDBSavedConnectionDirective(statement)
		if parseErr != nil {
			return "", fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.malformed", map[string]any{"detail": parseErr.Error()}))
		}
		if !isDirective {
			rewritten = append(rewritten, strings.TrimSuffix(strings.TrimSpace(statement), ";"))
			continue
		}
		if attacher == nil {
			var ok bool
			if attacher, ok = dbInst.(db.ExternalDatabaseAttacher); !ok {
				return "", fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.driver_missing", nil))
			}
		}
		message, err := a.executeDuckDBAttachDirective(ctx, attacher, directive)
		if err != nil {
			return "", err
		}
		rewritten = append(rewritten, "SELECT '"+escapeDuckDBSingleQuoted(message)+"' AS message")
		directiveSeen = true
	}
	if !directiveSeen {
		return query, nil
	}
	return strings.Join(rewritten, ";\n"), nil
}

func (a *App) executeDuckDBAttachDirective(ctx context.Context, attacher db.ExternalDatabaseAttacher, directive *duckDBAttachDirective) (string, error) {
	switch directive.kind {
	case duckDBAttachDirectiveKindDetach:
		err := attacher.DetachExternalDatabase(ctx, directive.alias)
		if err == nil {
			return a.appText("db.backend.info.duckdb_attach.detached", map[string]any{"alias": directive.alias}), nil
		}
		if errors.Is(err, db.ErrExternalAttachNotAttached) {
			return a.appText("db.backend.info.duckdb_attach.detached_missing", map[string]any{"alias": directive.alias}), nil
		}
		return "", fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.detach_failed", map[string]any{"detail": err.Error()}))
	default:
		view, err := a.resolveSavedConnectionForAttach(directive.ref)
		if err != nil {
			return "", err
		}
		// 密钥只在后端解析：快照合并即取当前最新凭据，凭据轮换后重新附加即生效
		_, bundle, err := a.savedConnectionRepository().loadConnectionSnapshot(view.ID)
		if err != nil {
			return "", fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.repository_unavailable", map[string]any{"detail": err.Error()}))
		}
		resolved := mergeConnectionSecretBundleIntoConfig(view.Config, bundle)
		spec, err := a.buildDuckDBAttachSpec(view, resolved, directive.alias, directive.readOnly)
		if err != nil {
			return "", err
		}
		if err := attacher.AttachExternalDatabase(ctx, spec); err != nil {
			return "", err
		}
		modeKey := "db.backend.info.duckdb_attach.mode_read_only"
		if !directive.readOnly {
			modeKey = "db.backend.info.duckdb_attach.mode_read_write"
		}
		logger.Infof("DuckDB 附加数据源：alias=%s connectionID=%s readOnly=%t", spec.Alias, view.ID, directive.readOnly)
		return a.appText("db.backend.info.duckdb_attach.success", map[string]any{
			"name":  strings.TrimSpace(view.Name),
			"alias": spec.Alias,
			"mode":  a.appText(modeKey, nil),
		}), nil
	}
}

func escapeDuckDBSingleQuoted(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}
