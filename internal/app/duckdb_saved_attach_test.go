package app

import (
	"context"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

type fakeDuckDBAttacher struct {
	// db.Database 仅用于满足 applyDuckDBSavedConnectionDirectives 的参数类型；
	// 嵌入接口后未实现的方法被调用会 panic，测试不会触达。
	db.Database
	attached       []db.ExternalAttachSpec
	detached       []string
	attachErr      error
	detachErr      error
	detachSentinel bool
}

func (f *fakeDuckDBAttacher) AttachExternalDatabase(ctx context.Context, spec db.ExternalAttachSpec) error {
	if f.attachErr != nil {
		return f.attachErr
	}
	f.attached = append(f.attached, spec)
	return nil
}

func (f *fakeDuckDBAttacher) DetachExternalDatabase(ctx context.Context, alias string) error {
	if f.detachSentinel {
		return db.ErrExternalAttachNotAttached
	}
	if f.detachErr != nil {
		return f.detachErr
	}
	f.detached = append(f.detached, alias)
	return nil
}

func newDuckDBAttachTestApp(t *testing.T) *App {
	t.Helper()
	app := NewAppWithSecretStore(newFakeAppSecretStore())
	app.configDir = t.TempDir()
	repo := app.savedConnectionRepository()
	if _, err := repo.Save(connection.SavedConnectionInput{
		ID:   "conn-uuid-1",
		Name: "生产库-订单",
		Config: connection.ConnectionConfig{
			ID: "conn-uuid-1", Type: "mysql", Host: "10.0.0.1", Port: 3306,
			User: "report", Password: "secret-1", Database: "orders",
		},
	}); err != nil {
		t.Fatalf("save mysql connection: %v", err)
	}
	if _, err := repo.Save(connection.SavedConnectionInput{
		ID:   "conn-uuid-2",
		Name: "生产库-订单",
		Config: connection.ConnectionConfig{
			ID: "conn-uuid-2", Type: "postgres", Host: "10.0.0.2", Port: 5432,
			User: "analyst", Password: "secret-2", Database: "warehouse",
		},
	}); err != nil {
		t.Fatalf("save postgres connection: %v", err)
	}
	if _, err := repo.Save(connection.SavedConnectionInput{
		ID:   "conn-uuid-3",
		Name: "本地文件库",
		Config: connection.ConnectionConfig{
			ID: "conn-uuid-3", Type: "duckdb", Host: "D:/data/analysis.duckdb",
		},
	}); err != nil {
		t.Fatalf("save duckdb connection: %v", err)
	}
	if _, err := repo.Save(connection.SavedConnectionInput{
		ID:   "conn-uuid-4",
		Name: "隧道库",
		Config: connection.ConnectionConfig{
			ID: "conn-uuid-4", Type: "mysql", Host: "10.0.0.3", Port: 3306,
			User: "u", Password: "p", Database: "d",
			UseSSH: true, SSH: connection.SSHConfig{Host: "bastion", Port: 22, User: "ops"},
		},
	}); err != nil {
		t.Fatalf("save tunnel connection: %v", err)
	}
	if _, err := repo.Save(connection.SavedConnectionInput{
		ID:   "conn-uuid-5",
		Name: "只读库",
		Config: connection.ConnectionConfig{
			ID: "conn-uuid-5", Type: "mysql", Host: "10.0.0.4", Port: 3306,
			User: "u", Password: "p", Database: "d", ReadOnly: true,
		},
	}); err != nil {
		t.Fatalf("save readonly connection: %v", err)
	}
	return app
}

func TestParseDuckDBSavedConnectionDirective(t *testing.T) {
	cases := []struct {
		name      string
		statement string
		wantParse bool
		wantErr   bool
		verify    func(t *testing.T, d *duckDBAttachDirective)
	}{
		{
			name:      "non directive passes through",
			statement: "SELECT 'ATTACH SAVED CONNECTION fake' AS x",
			wantParse: false,
		},
		{
			name:      "quoted id with alias and read only",
			statement: "ATTACH SAVED CONNECTION 'conn-uuid-1' AS orders_db READ ONLY;",
			wantParse: true,
			verify: func(t *testing.T, d *duckDBAttachDirective) {
				if d.ref != "conn-uuid-1" || d.alias != "orders_db" || !d.readOnly {
					t.Fatalf("unexpected directive: %+v", d)
				}
			},
		},
		{
			name:      "bareword ref default readonly no alias",
			statement: "attach saved connection conn-uuid-1",
			wantParse: true,
			verify: func(t *testing.T, d *duckDBAttachDirective) {
				if d.ref != "conn-uuid-1" || d.alias != "" || !d.readOnly {
					t.Fatalf("unexpected directive: %+v", d)
				}
			},
		},
		{
			name:      "read write variant",
			statement: "ATTACH SAVED CONNECTION 'x' READ_WRITE",
			wantParse: true,
			verify: func(t *testing.T, d *duckDBAttachDirective) {
				if d.readOnly {
					t.Fatalf("expected read write")
				}
			},
		},
		{
			name:      "escaped quotes in ref",
			statement: "ATTACH SAVED CONNECTION 'it''s db'",
			wantParse: true,
			verify: func(t *testing.T, d *duckDBAttachDirective) {
				if d.ref != "it's db" {
					t.Fatalf("ref = %q", d.ref)
				}
			},
		},
		{
			name:      "detach alias",
			statement: "DETACH SAVED CONNECTION orders_db;",
			wantParse: true,
			verify: func(t *testing.T, d *duckDBAttachDirective) {
				if d.kind != duckDBAttachDirectiveKindDetach || d.alias != "orders_db" {
					t.Fatalf("unexpected directive: %+v", d)
				}
			},
		},
		{
			name:      "malformed attach trailing clause",
			statement: "ATTACH SAVED CONNECTION 'x' EXTRA STUFF",
			wantParse: true,
			wantErr:   true,
		},
		{
			name:      "malformed unterminated quote",
			statement: "ATTACH SAVED CONNECTION 'x",
			wantParse: true,
			wantErr:   true,
		},
		{
			name:      "leading comment lines before directive",
			statement: "-- ① 附加远程订单库（幂等）\nATTACH SAVED CONNECTION 'conn-uuid-1' AS target READ ONLY;",
			wantParse: true,
			verify: func(t *testing.T, d *duckDBAttachDirective) {
				if d.ref != "conn-uuid-1" || d.alias != "target" || !d.readOnly {
					t.Fatalf("unexpected directive: %+v", d)
				}
			},
		},
		{
			name:      "comment only statement is not a directive",
			statement: "-- just a comment",
			wantParse: false,
		},
		{
			name:      "malformed detach alias",
			statement: "DETACH SAVED CONNECTION not an alias",
			wantParse: true,
			wantErr:   true,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			directive, isDirective, err := parseDuckDBSavedConnectionDirective(tc.statement)
			if isDirective != tc.wantParse {
				t.Fatalf("isDirective = %v, want %v", isDirective, tc.wantParse)
			}
			if tc.wantErr && err == nil {
				t.Fatalf("expected error")
			}
			if !tc.wantErr && tc.wantParse && err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tc.verify != nil && err == nil {
				tc.verify(t, directive)
			}
		})
	}
}

func TestSlugifyAttachAlias(t *testing.T) {
	cases := []struct {
		name string
		want string
	}{
		{name: "生产库-订单", want: "saved_db"},
		{name: "orders db", want: "orders_db"},
		{name: "  Report DB  ", want: "Report_DB"},
		{name: "9库", want: "saved_db"},
	}
	for _, tc := range cases {
		if got := slugifyAttachAlias(tc.name, ""); got != tc.want {
			t.Errorf("slugifyAttachAlias(%q) = %q, want %q", tc.name, got, tc.want)
		}
	}
	if got := slugifyAttachAlias("生产库", "a3f8c2e1-9d44"); got != "saved_db_a3f8c2e1" {
		t.Errorf("fallback slug = %q", got)
	}
}

func TestResolveSavedConnectionForAttach(t *testing.T) {
	app := newDuckDBAttachTestApp(t)

	view, err := app.resolveSavedConnectionForAttach("conn-uuid-1")
	if err != nil || view.ID != "conn-uuid-1" {
		t.Fatalf("resolve by id: view=%+v err=%v", view, err)
	}

	// 名称重名：报错并列出两个候选的 ID
	_, err = app.resolveSavedConnectionForAttach("生产库-订单")
	if err == nil || !strings.Contains(err.Error(), "conn-uuid-1") || !strings.Contains(err.Error(), "conn-uuid-2") {
		t.Fatalf("ambiguous name error = %v", err)
	}

	_, err = app.resolveSavedConnectionForAttach("不存在的连接")
	if err == nil {
		t.Fatalf("missing connection should error")
	}
}

func TestBuildDuckDBAttachSpec(t *testing.T) {
	app := newDuckDBAttachTestApp(t)

	view, err := app.resolveSavedConnectionForAttach("conn-uuid-1")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	_, bundle, err := app.savedConnectionRepository().loadConnectionSnapshot(view.ID)
	if err != nil {
		t.Fatalf("load snapshot: %v", err)
	}
	resolved := mergeConnectionSecretBundleIntoConfig(view.Config, bundle)
	spec, err := app.buildDuckDBAttachSpec(view, resolved, "", true)
	if err != nil {
		t.Fatalf("build spec: %v", err)
	}
	if spec.Kind != db.ExternalAttachKindMySQL || spec.Host != "10.0.0.1" || spec.Port != 3306 ||
		spec.User != "report" || spec.Password != "secret-1" || spec.Database != "orders" ||
		!spec.ReadOnly || spec.Alias != "saved_db_conn_uui" || spec.SecretName != "gonavi_attach_saved_db_conn_uui" {
		t.Fatalf("mysql spec = %+v", spec)
	}

	duckView, err := app.resolveSavedConnectionForAttach("conn-uuid-3")
	if err != nil {
		t.Fatalf("resolve duckdb: %v", err)
	}
	spec, err = app.buildDuckDBAttachSpec(duckView, duckView.Config, "local_duck", true)
	if err != nil || spec.Kind != db.ExternalAttachKindDuckDB || spec.FilePath != "D:/data/analysis.duckdb" || spec.Alias != "local_duck" {
		t.Fatalf("duckdb spec = %+v err = %v", spec, err)
	}

	tunnelView, err := app.resolveSavedConnectionForAttach("conn-uuid-4")
	if err != nil {
		t.Fatalf("resolve tunnel: %v", err)
	}
	if _, err = app.buildDuckDBAttachSpec(tunnelView, tunnelView.Config, "", true); err == nil ||
		!strings.Contains(err.Error(), "隧道") {
		t.Fatalf("tunnel error = %v", err)
	}

	roView, err := app.resolveSavedConnectionForAttach("conn-uuid-5")
	if err != nil {
		t.Fatalf("resolve readonly: %v", err)
	}
	if _, err = app.buildDuckDBAttachSpec(roView, roView.Config, "", false); err == nil ||
		!strings.Contains(err.Error(), "只读") {
		t.Fatalf("read write rejected error = %v", err)
	}

	unsupported := connection.SavedConnectionView{
		ID: "x", Name: "Oracle 库",
		Config: connection.ConnectionConfig{ID: "x", Type: "oracle", Host: "h", Password: "p"},
	}
	if _, err = app.buildDuckDBAttachSpec(unsupported, unsupported.Config, "", true); err == nil ||
		!strings.Contains(err.Error(), "oracle") {
		t.Fatalf("unsupported type error = %v", err)
	}
}

func TestApplyDuckDBSavedConnectionDirectives(t *testing.T) {
	app := newDuckDBAttachTestApp(t)
	fake := &fakeDuckDBAttacher{}

	t.Run("no directives returns query unchanged", func(t *testing.T) {
		original := "SELECT 1; SELECT 2;"
		got, err := app.applyDuckDBSavedConnectionDirectives(context.Background(), fake, original)
		if err != nil || got != original {
			t.Fatalf("got %q err %v", got, err)
		}
	})

	t.Run("attach and detach rewrite into synthetic selects", func(t *testing.T) {
		query := "ATTACH SAVED CONNECTION 'conn-uuid-1' AS orders_db;\nSELECT 1;\nDETACH SAVED CONNECTION orders_db;"
		got, err := app.applyDuckDBSavedConnectionDirectives(context.Background(), fake, query)
		if err != nil {
			t.Fatalf("apply: %v", err)
		}
		if !strings.Contains(got, "SELECT '") || strings.Contains(got, "ATTACH SAVED CONNECTION") {
			t.Fatalf("rewritten query = %q", got)
		}
		// 成功消息必须经过 i18n 渲染（含别名参数值），不允许出现原始键名
		if strings.Contains(got, "db.backend.info.") {
			t.Fatalf("unrendered i18n key in synthetic message: %q", got)
		}
		if !strings.Contains(got, "orders_db") {
			t.Fatalf("message missing alias param: %q", got)
		}
		if len(fake.attached) != 1 || fake.attached[0].Alias != "orders_db" {
			t.Fatalf("attached = %+v", fake.attached)
		}
		if fake.attached[0].Password != "secret-1" {
			t.Fatalf("resolved password mismatch: %q", fake.attached[0].Password)
		}
		if len(fake.detached) != 1 || fake.detached[0] != "orders_db" {
			t.Fatalf("detached = %v", fake.detached)
		}
		if !strings.Contains(got, "SELECT 1") {
			t.Fatalf("plain statement lost: %q", got)
		}
	})

	t.Run("resolution error surfaces i18n text", func(t *testing.T) {
		_, err := app.applyDuckDBSavedConnectionDirectives(context.Background(), fake,
			"ATTACH SAVED CONNECTION 'missing-conn';")
		if err == nil || !strings.Contains(err.Error(), "missing-conn") {
			t.Fatalf("err = %v", err)
		}
		if strings.Contains(err.Error(), "secret-1") {
			t.Fatalf("error leaked credentials: %v", err)
		}
	})

	t.Run("driver without attacher fails clearly", func(t *testing.T) {
		_, err := app.applyDuckDBSavedConnectionDirectives(context.Background(), nil,
			"ATTACH SAVED CONNECTION 'conn-uuid-1';")
		if err == nil {
			t.Fatalf("expected driver missing error")
		}
	})

	t.Run("detach missing alias maps to idempotent notice", func(t *testing.T) {
		sentinel := &fakeDuckDBAttacher{detachSentinel: true}
		got, err := app.applyDuckDBSavedConnectionDirectives(context.Background(), sentinel,
			"DETACH SAVED CONNECTION nope;")
		if err != nil {
			t.Fatalf("detach missing should be idempotent, got %v", err)
		}
		if !strings.Contains(got, "SELECT '") {
			t.Fatalf("rewritten = %q", got)
		}
	})

	t.Run("attach failure propagates driver error", func(t *testing.T) {
		failing := &fakeDuckDBAttacher{attachErr: context.DeadlineExceeded}
		if _, err := app.applyDuckDBSavedConnectionDirectives(context.Background(), failing,
			"ATTACH SAVED CONNECTION 'conn-uuid-1';"); err == nil {
			t.Fatalf("expected attach failure")
		}
	})
}
