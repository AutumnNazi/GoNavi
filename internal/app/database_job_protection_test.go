package app

import (
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/sqlaudit"
)

func TestDatabaseJobMutationClassification(t *testing.T) {
	tests := []struct {
		query string
		write bool
	}{
		{"SELECT cron.schedule('nightly', '* * * * *', 'SELECT 1')", true},
		{"SELECT \"cron\" /* scope */ . \"alter_job\"(7, active := false)", true},
		{"SELECT cron.unschedule(7)", true},
		{"SELECT PKG_SERVICE.JOB_UPDATE(7, NULL, 'sysdate + 1', 'SELECT 1')", true},
		{"SELECT DBE_TASK.FINISH(7, TRUE, now())", true},
		{"BEGIN DBMS_SCHEDULER.RUN_JOB('APP.J', FALSE); END;", true},
		{"SELECT 'cron.alter_job(7)'", false},
		{"SELECT $$cron.unschedule(7)$$", false},
		{"SELECT 1 -- cron.schedule(7)\n", false},
		{"SELECT * FROM cron.job", false},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			if got := hasDatabaseJobMutationSQL("postgres", tt.query); got != tt.write {
				t.Fatalf("mutation = %v, want %v", got, tt.write)
			}
			if tt.write && isReadOnlySQLQuery("postgres", tt.query) {
				t.Fatal("scheduler mutation classified as read-only")
			}
		})
	}
}

func TestDatabaseJobMutationProtections(t *testing.T) {
	for _, protection := range []connection.ConnectionProtectionConfig{
		{RestrictDataEdit: true}, {RestrictStructureEdit: true}, {RestrictScriptExecution: true},
	} {
		config := connection.ConnectionConfig{Type: "postgres", Protection: protection}
		if err := ensureConnectionAllowsQuery(config, "SELECT cron.alter_job(1, active := true)"); err == nil {
			t.Fatalf("protection bypassed: %#v", protection)
		}
		if err := ensureConnectionAllowsQuery(config, "SELECT * FROM cron.job"); err != nil {
			t.Fatalf("catalog read denied: %v", err)
		}
	}
}

func TestDatabaseJobsAuditDenial(t *testing.T) {
	app := newSQLAuditTestApp(t)
	config := connection.ConnectionConfig{Type: "postgres", Protection: connection.ConnectionProtectionConfig{RestrictStructureEdit: true}}
	result := app.DBQueryAudited(config, "postgres", "UPDATE pgagent.pga_job SET jobenabled=true WHERE jobid=1", "database_jobs")
	if result.Success || result.Message == "" {
		t.Fatalf("job management bypassed protection: %#v", result)
	}
	events := loadSQLAuditEvents(t, app, sqlaudit.Filter{Search: result.QueryID})
	if len(events) != 1 || events[0].Source != "database_jobs" || events[0].Status != "error" {
		t.Fatalf("denial audit = %#v", events)
	}
}
