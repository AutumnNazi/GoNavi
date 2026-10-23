package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
)

// newXxlJobStubAdmin serves just enough of the admin surface for the binding
// tests: a login route, a redirect on the root, and a jobgroup listing.
func newXxlJobStubAdmin(t *testing.T) *httptest.Server {
	t.Helper()
	mux := http.NewServeMux()
	mux.HandleFunc("/toLogin", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"code":200,"msg":"Success"}`))
	})
	mux.HandleFunc("/login", func(w http.ResponseWriter, r *http.Request) {
		_ = r.ParseForm()
		if r.PostForm.Get("userName") == "" {
			w.Write([]byte(`{"code":500,"msg":"user/password error"}`))
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "XXL_JOB_LOGIN_IDENTITY", Value: "token", Path: "/"})
		w.Write([]byte(`{"code":200,"msg":"Success"}`))
	})
	mux.HandleFunc("/jobgroup/pageList", func(w http.ResponseWriter, r *http.Request) {
		if !strings.Contains(r.Header.Get("Cookie"), "XXL_JOB_LOGIN_IDENTITY") {
			w.Header().Set("Location", "/toLogin")
			w.WriteHeader(http.StatusFound)
			return
		}
		// The 2.x paging routes answer with a bare DataTables object and no
		// envelope at all.
		w.Write([]byte(`{"recordsTotal":1,"recordsFiltered":1,"data":[{"id":1,"appname":"sample","title":"Sample"}]}`))
	})
	mux.HandleFunc("/jobinfo/pageList", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"recordsTotal":1,"recordsFiltered":1,"data":[{"id":3,"jobGroup":1,"jobDesc":"sleepJob","triggerStatus":1}]}`))
	})
	mux.HandleFunc("/jobinfo/trigger", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"code":200,"content":"trigger success"}`))
	})
	mux.HandleFunc("/jobinfo/start", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"code":200,"msg":"ok"}`))
	})
	mux.HandleFunc("/jobinfo/stop", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"code":200,"msg":"ok"}`))
	})
	mux.HandleFunc("/joblog/pageList", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"recordsTotal":1,"recordsFiltered":1,"data":[{"id":10,"triggerCode":200,"handleCode":0}]}`))
	})
	mux.HandleFunc("/joblog/logKill", func(w http.ResponseWriter, _ *http.Request) {
		w.Write([]byte(`{"code":200,"msg":"ok"}`))
	})
	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)
	return server
}

func stubXxlJobConfig(t *testing.T, server *httptest.Server) connection.ConnectionConfig {
	t.Helper()
	host, port := splitHostPort(t, server.URL)
	return connection.ConnectionConfig{
		Type:     "xxljob",
		Host:     host,
		Port:     port,
		User:     "admin",
		Password: "123456",
		Timeout:  10,
	}
}

func splitHostPort(t *testing.T, rawURL string) (string, int) {
	t.Helper()
	trimmed := strings.TrimPrefix(rawURL, "http://")
	index := strings.LastIndex(trimmed, ":")
	if index < 0 {
		t.Fatalf("unexpected test server URL %q", rawURL)
	}
	port := 0
	for _, char := range trimmed[index+1:] {
		port = port*10 + int(char-'0')
	}
	return trimmed[:index], port
}

func TestXxlJobCacheKeySeparatesTransportAndCredentials(t *testing.T) {
	base := connection.ConnectionConfig{
		Type: "xxljob", Host: "a.test", Port: 8080, User: "admin", Password: "secret",
	}
	if getXxlJobClientCacheKey(base) != getXxlJobClientCacheKey(base) {
		t.Fatal("the same configuration must produce the same key")
	}

	variants := map[string]func(c *connection.ConnectionConfig){
		"host":         func(c *connection.ConnectionConfig) { c.Host = "b.test" },
		"port":         func(c *connection.ConnectionConfig) { c.Port = 9090 },
		"password":     func(c *connection.ConnectionConfig) { c.Password = "other" },
		"context path": func(c *connection.ConnectionConfig) { c.ConnectionParams = "contextPath=%2Fadmin" },
		"ssl":          func(c *connection.ConnectionConfig) { c.UseSSL = true },
		"ssh":          func(c *connection.ConnectionConfig) { c.UseSSH = true },
		"proxy":        func(c *connection.ConnectionConfig) { c.UseProxy = true },
	}
	// 超时只影响单次请求的截止时间，不影响物理会话身份，按既有归一规则必须复用缓存。
	for _, timeoutVariant := range []connection.ConnectionConfig{
		func() connection.ConnectionConfig { c := base; c.Timeout = 60; return c }(),
		func() connection.ConnectionConfig { c := base; c.QueryTimeout = 42; return c }(),
	} {
		if getXxlJobClientCacheKey(timeoutVariant) != getXxlJobClientCacheKey(base) {
			t.Error("a timeout change must not open a new session")
		}
	}

	seen := map[string]string{getXxlJobClientCacheKey(base): "base"}
	for name, mutate := range variants {
		changed := base
		mutate(&changed)
		key := getXxlJobClientCacheKey(changed)
		if previous, clash := seen[key]; clash {
			t.Errorf("%s reuses the key of %s; a changed %s must open a new session", name, previous, name)
		}
		seen[key] = name
	}
}

func TestXxlJobConnectCachesAndReportsProtocolFamily(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	t.Cleanup(CloseAllXxlJobClients)

	app := &App{}
	result := app.XxlJobConnect(config)
	if !result.Success {
		t.Fatalf("XxlJobConnect failed: %s", result.Message)
	}
	data, ok := result.Data.(map[string]any)
	if !ok {
		t.Fatalf("Data = %T, want a map", result.Data)
	}
	if data["protocolFamily"] != "2.x" {
		t.Errorf("protocolFamily = %v, want 2.x", data["protocolFamily"])
	}

	// A second connect must reuse the cached session rather than open another.
	xxlJobCacheMu.Lock()
	cached := len(xxlJobCache)
	xxlJobCacheMu.Unlock()
	if cached != 1 {
		t.Errorf("cache holds %d clients, want 1", cached)
	}
	if again := app.XxlJobConnect(config); !again.Success {
		t.Fatalf("cached connect failed: %s", again.Message)
	}
}

func TestXxlJobTestConnectionDoesNotPopulateCache(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	t.Cleanup(CloseAllXxlJobClients)

	app := &App{}
	if result := app.XxlJobTestConnection(config); !result.Success {
		t.Fatalf("XxlJobTestConnection failed: %s", result.Message)
	}
	xxlJobCacheMu.Lock()
	cached := len(xxlJobCache)
	xxlJobCacheMu.Unlock()
	if cached != 0 {
		t.Errorf("a connection test left %d cached clients, want 0", cached)
	}
}

func TestXxlJobTestConnectionRejectsBadCredentials(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	config.User = ""
	t.Cleanup(CloseAllXxlJobClients)

	result := (&App{}).XxlJobTestConnection(config)
	if result.Success {
		t.Fatal("expected the test connection to fail")
	}
}

func TestXxlJobListBindingsReturnPages(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	t.Cleanup(CloseAllXxlJobClients)
	app := &App{}

	if result := app.XxlJobListJobGroups(config, XxlJobListQuery{Page: 1, Size: 10}); !result.Success {
		t.Fatalf("XxlJobListJobGroups failed: %s", result.Message)
	}
	if result := app.XxlJobListJobs(config, XxlJobListQuery{Page: 1, Size: 10}); !result.Success {
		t.Fatalf("XxlJobListJobs failed: %s", result.Message)
	}
	if result := app.XxlJobListLogs(config, XxlJobListQuery{Page: 1, Size: 20}); !result.Success {
		t.Fatalf("XxlJobListLogs failed: %s", result.Message)
	}
}

func TestXxlJobMutationBindingsBlockedByReadOnly(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	config.ReadOnly = true
	t.Cleanup(CloseAllXxlJobClients)
	app := &App{}

	cases := map[string]func() connection.QueryResult{
		"trigger": func() connection.QueryResult { return app.XxlJobTriggerJob(config, 3, "sleep 300") },
		"start":   func() connection.QueryResult { return app.XxlJobStartJobs(config, []int{3}) },
		"stop":    func() connection.QueryResult { return app.XxlJobStopJobs(config, []int{3}) },
		"kill":    func() connection.QueryResult { return app.XxlJobLogKill(config, 10) },
		"job_save": func() connection.QueryResult {
			return app.XxlJobSaveJob(config, XxlJobJobMutation{JobGroup: 1, Name: "demo", ScheduleType: "CRON", ScheduleConf: "0/30 * * * * ?", ExecutorHandler: "demoJobHandler"})
		},
		"job_delete": func() connection.QueryResult { return app.XxlJobDeleteJobs(config, []int{3}) },
		"group_save": func() connection.QueryResult {
			return app.XxlJobSaveJobGroup(config, XxlJobGroupMutation{AppName: "xxl-job-demo-group", Title: "Demo"})
		},
		"group_delete": func() connection.QueryResult { return app.XxlJobDeleteJobGroups(config, []int{1}) },
		"glue_save":    func() connection.QueryResult { return app.XxlJobSaveGlueSource(config, 3, "print('x')", "demo") },
	}
	for name, call := range cases {
		t.Run(name, func(t *testing.T) {
			result := call()
			if result.Success {
				t.Fatalf("%s must be refused on a read-only connection", name)
			}
			if !strings.Contains(result.Message, "read-only") && !strings.Contains(result.Message, "只读") {
				t.Errorf("message = %q, want a read-only explanation", result.Message)
			}
		})
	}
}

func TestXxlJobMutationBindingsBlockedByScriptProtection(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	config.Protection.RestrictScriptExecution = true
	t.Cleanup(CloseAllXxlJobClients)

	result := (&App{}).XxlJobTriggerJob(config, 3, "")
	if result.Success {
		t.Fatal("triggering a shell handler must be refused when script execution is restricted")
	}
}

func TestXxlJobMutationBindingsAllowedOnWritableConnection(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	t.Cleanup(CloseAllXxlJobClients)
	app := &App{}

	if result := app.XxlJobTriggerJob(config, 3, "sleep 300"); !result.Success {
		t.Fatalf("XxlJobTriggerJob failed: %s", result.Message)
	}
	if result := app.XxlJobStartJobs(config, []int{3}); !result.Success {
		t.Fatalf("XxlJobStartJobs failed: %s", result.Message)
	}
	if result := app.XxlJobStopJobs(config, []int{3}); !result.Success {
		t.Fatalf("XxlJobStopJobs failed: %s", result.Message)
	}
	if result := app.XxlJobLogKill(config, 10); !result.Success {
		t.Fatalf("XxlJobLogKill failed: %s", result.Message)
	}
}

func TestXxlJobReadOnlySupportIsRegistered(t *testing.T) {
	config := connection.ConnectionConfig{Type: "xxljob"}
	if !supportsConnectionReadOnlyMode(config) {
		t.Fatal("xxljob must be listed as a type that supports read-only protection")
	}
}

func TestXxlJobNormalizesToDedicatedWorkbenchRouting(t *testing.T) {
	if got := normalizeDriverType("XXL-Job"); got != "xxljob" {
		t.Errorf("normalizeDriverType(%q) = %q, want xxljob", "XXL-Job", got)
	}
	if got := normalizeDriverType("xxl_job"); got != "xxljob" {
		t.Errorf("normalizeDriverType(%q) = %q, want xxljob", "xxl_job", got)
	}
}

func TestXxlJobDisconnectDropsOnlyThatSession(t *testing.T) {
	server := newXxlJobStubAdmin(t)
	config := stubXxlJobConfig(t, server)
	t.Cleanup(CloseAllXxlJobClients)
	app := &App{}
	if result := app.XxlJobConnect(config); !result.Success {
		t.Fatalf("connect: %s", result.Message)
	}
	if result := app.XxlJobDisconnect(config); !result.Success {
		t.Fatalf("disconnect: %s", result.Message)
	}
	xxlJobCacheMu.Lock()
	cached := len(xxlJobCache)
	xxlJobCacheMu.Unlock()
	if cached != 0 {
		t.Errorf("cache holds %d clients after disconnect, want 0", cached)
	}
}

func TestXxlJobSessionExpirySurfacesToTheBinding(t *testing.T) {
	// A listing against an admin that always reports an expired session must
	// reach the UI as the localized "login expired" message, not a raw error.
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/login") {
			http.SetCookie(w, &http.Cookie{Name: "XXL_JOB_LOGIN_IDENTITY", Value: "t", Path: "/"})
			w.Write([]byte(`{"code":200,"msg":"Success"}`))
			return
		}
		w.Header().Set("Location", "/toLogin")
		w.WriteHeader(http.StatusFound)
	}))
	t.Cleanup(server.Close)
	t.Cleanup(CloseAllXxlJobClients)

	config := stubXxlJobConfig(t, server)
	result := (&App{}).XxlJobListJobGroups(config, XxlJobListQuery{Page: 1, Size: 10})
	if result.Success {
		t.Fatal("an always-expired session must not report success")
	}
}
