package app

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/utils"
)

// duckDBAttachParseError 携带 i18n 键的解析错误；展示文本由调用方经 appText 渲染，
// 解析函数本身不产出用户可见文案（AGENTS.md §4.3）。
type duckDBAttachParseError struct {
	key    string
	params map[string]any
}

func (e *duckDBAttachParseError) Error() string { return e.key }

func newDuckDBAttachParseError(key string, params map[string]any) *duckDBAttachParseError {
	return &duckDBAttachParseError{key: "db.backend.error.duckdb_attach." + key, params: params}
}

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
	// 指令前缀允许词间任意空白（多空格、换行）；\b 防止误匹配 CONNECTIONS 等扩展词。
	duckDBAttachDirectivePrefixPattern = regexp.MustCompile(`(?i)^ATTACH\s+SAVED\s+CONNECTION\b`)
	duckDBDetachDirectivePrefixPattern = regexp.MustCompile(`(?i)^DETACH\s+SAVED\s+CONNECTION\b`)
	// 快速预筛：绝大多数查询不含指令，避免对大文本做整串大写拷贝与语句切分。
	duckDBSavedConnectionDirectivePattern = regexp.MustCompile(`(?i)ATTACH\s+SAVED\s+CONNECTION|DETACH\s+SAVED\s+CONNECTION`)
)

// parseDuckDBSavedConnectionDirective 判断一条语句是否为附加/卸载指令。
// 第二个返回值为 false 表示不是指令（原样执行）；true 但带错误表示语句以
// 指令开头但格式非法，应向用户报错而不是静默透传。
// 语句允许以 -- 行注释开头（注释与指令常被分词器合并为一条语句）。
func parseDuckDBSavedConnectionDirective(statement string) (*duckDBAttachDirective, bool, error) {
	trimmed := strings.TrimSpace(statement)
	for strings.HasPrefix(trimmed, "--") {
		nl := strings.IndexByte(trimmed, '\n')
		if nl < 0 {
			// 整条语句都是注释
			return nil, false, nil
		}
		trimmed = strings.TrimSpace(trimmed[nl+1:])
	}
	trimmed = strings.TrimSuffix(trimmed, ";")
	trimmed = strings.TrimSpace(trimmed)
	// 尾部整行注释对称剥离（前导注释已支持）：否则注释被当作未知子句报错
	for {
		lines := strings.Split(trimmed, "\n")
		if len(lines) == 1 || !strings.HasPrefix(strings.TrimSpace(lines[len(lines)-1]), "--") {
			break
		}
		trimmed = strings.TrimSpace(strings.Join(lines[:len(lines)-1], "\n"))
	}
	if match := duckDBAttachDirectivePrefixPattern.FindStringSubmatchIndex(trimmed); match != nil {
		return parseDuckDBAttachDirectiveBody(strings.TrimSpace(trimmed[match[1]:]))
	}
	if match := duckDBDetachDirectivePrefixPattern.FindStringSubmatchIndex(trimmed); match != nil {
		return parseDuckDBDetachDirectiveBody(strings.TrimSpace(trimmed[match[1]:]))
	}
	return nil, false, nil
}

func parseDuckDBAttachDirectiveBody(body string) (*duckDBAttachDirective, bool, error) {
	if body == "" {
		return nil, true, newDuckDBAttachParseError("parse_missing_ref", nil)
	}
	ref, rest, err := consumeDuckDBAttachRef(body)
	if err != nil {
		return nil, true, err
	}
	if strings.TrimSpace(ref) == "" {
		// 空引用（如 ''）：按缺少引用报错，而不是落到 connection_not_found
		return nil, true, newDuckDBAttachParseError("parse_missing_ref", nil)
	}
	directive := &duckDBAttachDirective{kind: duckDBAttachDirectiveKindAttach, ref: ref, readOnly: true}

	rest = strings.TrimSpace(rest)
	if rest == "" {
		return directive, true, nil
	}
	// 可选 AS <alias>（AS 后允许任意空白，含换行）
	if len(rest) >= 3 && strings.EqualFold(rest[:2], "AS") && (rest[2] == ' ' || rest[2] == '\t' || rest[2] == '\n' || rest[2] == '\r') {
		aliasPart := strings.TrimSpace(rest[3:])
		parts := strings.Fields(aliasPart)
		if len(parts) == 0 || !duckDBAttachIdentifierPattern.MatchString(parts[0]) {
			return nil, true, newDuckDBAttachParseError("parse_alias_invalid", nil)
		}
		directive.alias = parts[0]
		rest = strings.TrimSpace(strings.Join(parts[1:], " "))
		if rest == "" {
			return directive, true, nil
		}
	}
	// 可选 READ ONLY / READ WRITE（兼容连写、下划线与任意空白写法）
	mode := strings.Join(strings.Fields(strings.ToUpper(strings.ReplaceAll(rest, "_", " "))), "")
	switch mode {
	case "READONLY":
		directive.readOnly = true
	case "READWRITE":
		directive.readOnly = false
	default:
		return nil, true, newDuckDBAttachParseError("parse_clause_unknown", map[string]any{"clause": rest})
	}
	return directive, true, nil
}

func parseDuckDBDetachDirectiveBody(body string) (*duckDBAttachDirective, bool, error) {
	if body == "" {
		return nil, true, newDuckDBAttachParseError("parse_detach_missing_alias", nil)
	}
	fields := strings.Fields(body)
	if len(fields) != 1 || !duckDBAttachIdentifierPattern.MatchString(fields[0]) {
		return nil, true, newDuckDBAttachParseError("parse_detach_alias_invalid", nil)
	}
	return &duckDBAttachDirective{kind: duckDBAttachDirectiveKindDetach, alias: fields[0]}, true, nil
}

// consumeDuckDBAttachRef 读取连接引用：单引号字符串（成对单引号转义）或无空格裸词。
func consumeDuckDBAttachRef(body string) (string, string, error) {
	if body == "" {
		return "", "", newDuckDBAttachParseError("parse_missing_ref", nil)
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
		return "", "", newDuckDBAttachParseError("parse_unclosed_quote", nil)
	}
	end := 0
	for end < len(body) && body[end] != ' ' && body[end] != '\t' && body[end] != '\n' && body[end] != '\r' {
		end++
	}
	ref := body[:end]
	if !duckDBAttachBarewordPattern.MatchString(ref) {
		return "", "", newDuckDBAttachParseError("parse_quoted_required", nil)
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
			// 仅取 ID 的字母数字并剥掉常见 conn 前缀：保证后缀来自 ID 的随机段
			//（8 位 hex ≈ 43 亿空间），避免形如 conn-<hex> 的 ID 只贡献 3 位熵
			var idBuilder strings.Builder
			for _, r := range trimmedID {
				if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
					idBuilder.WriteRune(r)
				}
			}
			sanitizedID := strings.TrimPrefix(idBuilder.String(), "conn")
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
		Alias:        finalAlias,
		ReadOnly:     readOnly,
		SecretName:   "gonavi_attach_" + finalAlias,
		ConnectionID: strings.TrimSpace(view.ID),
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

// queryContainsDuckDBSavedConnectionDirective 判断查询中是否存在真实指令语句
// （语句级解析，字符串字面量/注释中出现的同形文本不误伤）；
// 供事务路径等不做指令改写的入口做防御性拦截。
func queryContainsDuckDBSavedConnectionDirective(query string) bool {
	for _, statement := range splitSQLStatementsForDialect("duckdb", query) {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, isDirective, _ := parseDuckDBSavedConnectionDirective(statement); isDirective {
			return true
		}
	}
	return false
}

// applyDuckDBSavedConnectionDirectives 在语句级扫描 DuckDB 查询：附加/卸载指令
// 由本层执行，改写为一条返回执行结果的合成 SELECT 交给后续管道；其余语句原样保留。
// 返回改写后的查询文本；无指令时原样返回。
func (a *App) applyDuckDBSavedConnectionDirectives(ctx context.Context, dbInst db.Database, query string) (string, error) {
	// 快速短路：绝大多数查询不含指令，避免无谓的语句切分（管道随后还要切一次）
	if !duckDBSavedConnectionDirectivePattern.MatchString(query) {
		return query, nil
	}
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
			var parseTyped *duckDBAttachParseError
			detail := parseErr.Error()
			if errors.As(parseErr, &parseTyped) {
				detail = a.appText(parseTyped.key, parseTyped.params)
			}
			return "", fmt.Errorf("%s", a.appText("db.backend.error.duckdb_attach.malformed", map[string]any{"detail": detail}))
		}
		if !isDirective {
			rewritten = append(rewritten, ensureStatementSemicolonSafety(strings.TrimSuffix(strings.TrimSpace(statement), ";")))
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

// wrapDuckDBAttachAgentOutdatedError 旧版驱动代理没有 attach RPC，错误文本落在
// “不支持的方法”：替换为可行动的重装指引，避免用户误判为数据源不支持。
// 返回空串表示不是该类错误，调用方沿用原错误处理。
func (a *App) wrapDuckDBAttachAgentOutdatedError(err error) string {
	if err == nil {
		return ""
	}
	text := err.Error()
	lower := strings.ToLower(text)
	if !strings.Contains(text, "不支持的方法") && !strings.Contains(lower, "unsupported method") && !strings.Contains(lower, "unknown method") {
		return ""
	}
	return a.appText("db.backend.error.duckdb_attach.agent_outdated", nil)
}

// ensureStatementSemicolonSafety 语句含未加引号的行注释时补一个换行：rejoin 的
// 分号若紧跟注释（同行或注释行尾）会被吞掉，导致相邻语句被静默合并、语义改变。
// 单引号感知：'a--b' 这类字面量不触发。
func ensureStatementSemicolonSafety(stmt string) string {
	inSingle := false
	for i := 0; i < len(stmt); i++ {
		switch ch := stmt[i]; {
		case inSingle:
			if ch == '\'' {
				if i+1 < len(stmt) && stmt[i+1] == '\'' {
					i++
					continue
				}
				inSingle = false
			}
		case ch == '\'':
			inSingle = true
		case ch == '-' && i+1 < len(stmt) && stmt[i+1] == '-':
			return stmt + "\n"
		}
	}
	return stmt
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
		if agentErr := a.wrapDuckDBAttachAgentOutdatedError(err); agentErr != "" {
			return "", fmt.Errorf("%s", agentErr)
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
			if agentErr := a.wrapDuckDBAttachAgentOutdatedError(err); agentErr != "" {
				return "", fmt.Errorf("%s", agentErr)
			}
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

// ListDuckDBAttachedDatasources 供前端“附加已保存数据源”选择器查询当前
// DuckDB 连接上由本功能创建、仍然有效的附加关系（别名/来源连接/只读模式）。
// 连接未打开或驱动不支持时返回空列表，前端据此不展示状态。
func (a *App) ListDuckDBAttachedDatasources(config connection.ConnectionConfig, dbName string) ([]db.ExternalAttachmentInfo, error) {
	runConfig := normalizeRunConfig(config, dbName)
	ctx, cancel := utils.ContextWithTimeout(15 * time.Second)
	defer cancel()
	dbInst, err := a.getDatabaseWithContext(ctx, runConfig, false)
	if err != nil {
		logger.Warnf("查询 DuckDB 附加状态失败（连接未建立）：%v", err)
		return []db.ExternalAttachmentInfo{}, nil
	}
	lister, ok := dbInst.(db.ExternalAttachmentLister)
	if !ok {
		return []db.ExternalAttachmentInfo{}, nil
	}
	infos, err := lister.ListExternalAttachments(ctx)
	if err != nil {
		logger.Warnf("查询 DuckDB 附加状态失败：%v", err)
		return []db.ExternalAttachmentInfo{}, nil
	}
	return infos, nil
}
func escapeDuckDBSingleQuoted(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}
