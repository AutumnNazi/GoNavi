package xxljob

import (
	"errors"
	"strconv"
	"testing"
)

func TestListJobGroupsPagingAndFilterPerStack(t *testing.T) {
	cases := []struct {
		flavor       adminFlavor
		wantStart    string
		wantLength   string
		wantOffset   string
		wantPagesize string
		wantFilter   string
	}{
		{flavor2x, "0", "10", "", "", "title"},
		{flavor32x, "0", "10", "", "", "title"},
		{flavor35, "", "", "0", "10", "name"},
	}
	for _, tc := range cases {
		t.Run(tc.flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, tc.flavor, "")
			client, _ := mustConnectFake(t, admin)
			ctx, cancel := testContext(t)
			defer cancel()

			page, err := client.NewProtocol().ListJobGroups(ctx, GroupListRequest{
				Page: 1, Size: 10, AppName: "", Title: "",
			})
			if err != nil {
				t.Fatalf("ListJobGroups: %v", err)
			}
			assertPaging(t, admin, routeJobGroupPageList, tc.wantStart, tc.wantLength, tc.wantOffset, tc.wantPagesize)

			// The filter parameter is always present, blank meaning "no filter".
			call, _ := admin.lastCallTo(routeJobGroupPageList)
			if _, ok := call.Form[tc.wantFilter]; !ok {
				t.Errorf("filter %q missing from %v", tc.wantFilter, call.Form)
			}
			if len(page.Rows) != 1 || page.Rows[0].AppName != "xxl-job-executor-sample" {
				t.Fatalf("rows = %+v", page.Rows)
			}
			// Both eras collapse onto one field name for the UI.
			if page.Rows[0].DisplayName() != "Sample Executor" {
				t.Errorf("DisplayName = %q", page.Rows[0].DisplayName())
			}
			if page.Total != 1 {
				t.Errorf("Total = %d, want 1", page.Total)
			}
		})
	}
}

func TestListJobsAlwaysSendsEveryFilter(t *testing.T) {
	// XXL-JOB rejects a task listing that omits any filter parameter, so the
	// blank ones matter as much as the filled ones.
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, flavor, "")
			client, _ := mustConnectFake(t, admin)
			ctx, cancel := testContext(t)
			defer cancel()

			page, err := client.NewProtocol().ListJobs(ctx, JobListRequest{
				Page: 2, Size: 10, JobGroup: 1, TriggerStatus: 1, Name: "",
			})
			if err != nil {
				t.Fatalf("ListJobs: %v", err)
			}
			call, _ := admin.lastCallTo(routeJobInfoPageList)
			for _, key := range []string{"jobGroup", "triggerStatus", "executorHandler", "author"} {
				if _, ok := call.Form[key]; !ok {
					t.Errorf("required filter %q missing from %v", key, call.Form)
				}
			}
			wantNameParam := "jobDesc"
			if flavor.fields == FieldRenamed {
				wantNameParam = "name"
			}
			if _, ok := call.Form[wantNameParam]; !ok {
				t.Errorf("name filter %q missing from %v", wantNameParam, call.Form)
			}
			// The row lands on one field regardless of which name was sent.
			if len(page.Rows) != 1 || page.Rows[0].Name != "demoJobHandler" {
				t.Fatalf("rows = %+v", page.Rows)
			}
			if !page.Rows[0].IsRunning() {
				t.Error("triggerStatus 1 should read as running")
			}
		})
	}
}

func TestStartStopUseStackSpecificIDParam(t *testing.T) {
	cases := []struct {
		flavor  adminFlavor
		wantIDs bool
	}{
		{flavor2x, false},
		{flavor32x, false},
		{flavor35, true},
	}
	for _, tc := range cases {
		t.Run(tc.flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, tc.flavor, "")
			client, _ := mustConnectFake(t, admin)
			ctx, cancel := testContext(t)
			defer cancel()
			protocol := client.NewProtocol()

			if err := protocol.StartJobs(ctx, []int{7}); err != nil {
				t.Fatalf("StartJobs: %v", err)
			}
			if err := protocol.StopJobs(ctx, []int{8}); err != nil {
				t.Fatalf("StopJobs: %v", err)
			}
			assertIDParam(t, admin, routeJobInfoStart, 7, tc.wantIDs)
			assertIDParam(t, admin, routeJobInfoStop, 8, tc.wantIDs)
		})
	}
}

func assertIDParam(t *testing.T, admin *fakeAdmin, path string, wantID int, batch bool) {
	t.Helper()
	call, ok := admin.lastCallTo(path)
	if !ok {
		t.Fatalf("no call recorded for %s", path)
	}
	if batch {
		if got := call.Form["ids[]"]; len(got) != 1 || got[0] != strconv.Itoa(wantID) {
			t.Errorf("%s ids[] = %v, want [%d]", path, got, wantID)
		}
		return
	}
	if got := call.Form.Get("id"); got != strconv.Itoa(wantID) {
		t.Errorf("%s id = %q, want %d", path, got, wantID)
	}
}

func assertPaging(t *testing.T, admin *fakeAdmin, path, wantStart, wantLength, wantOffset, wantPagesize string) {
	t.Helper()
	call, ok := admin.lastCallTo(path)
	if !ok {
		t.Fatalf("no call recorded for %s", path)
	}
	assertParam(t, call, "start", wantStart)
	assertParam(t, call, "length", wantLength)
	assertParam(t, call, "offset", wantOffset)
	assertParam(t, call, "pagesize", wantPagesize)
}

func assertParam(t *testing.T, call recordedCall, key, want string) {
	t.Helper()
	got := call.Form.Get(key)
	if want == "" {
		if got != "" {
			t.Errorf("%s = %q, want it absent", key, got)
		}
		return
	}
	if got != want {
		t.Errorf("%s = %q, want %q", key, got, want)
	}
}

func TestTriggerJobSendsOptionalParamAndAddressList(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, flavor, "")
			client, _ := mustConnectFake(t, admin)
			ctx, cancel := testContext(t)
			defer cancel()

			message, err := client.NewProtocol().TriggerJob(ctx, 3, "sleep 300")
			if err != nil {
				t.Fatalf("TriggerJob: %v", err)
			}
			if message == "" {
				t.Error("expected the admin's dispatch message")
			}
			call, _ := admin.lastCallTo(routeJobInfoTrigger)
			if got := call.Form.Get("executorParam"); got != "sleep 300" {
				t.Errorf("executorParam = %q", got)
			}
			// A blank addressList routes through auto registration.
			if _, ok := call.Form["addressList"]; !ok {
				t.Errorf("addressList must be present, got %v", call.Form)
			}
		})
	}
}

func TestTriggerJobRejectsZeroID(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()
	if _, err := client.NewProtocol().TriggerJob(ctx, 0, ""); !errors.Is(err, ErrValidation) {
		t.Fatalf("error = %v, want ErrValidation", err)
	}
}

func TestNextTriggerTimes(t *testing.T) {
	admin := newFakeAdmin(t, flavor35, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()

	times, err := client.NewProtocol().NextTriggerTimes(ctx, "CRON", "0/30 * * * * ?")
	if err != nil {
		t.Fatalf("NextTriggerTimes: %v", err)
	}
	if len(times) != 2 || times[0] != "2026-10-17 10:00:00" {
		t.Fatalf("times = %v", times)
	}
}

func TestNextTriggerTimesRequiresSchedule(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()
	if _, err := client.NewProtocol().NextTriggerTimes(ctx, "", ""); !errors.Is(err, ErrValidation) {
		t.Fatalf("error = %v, want ErrValidation", err)
	}
}

func TestListLogsSendsFiltersAndNormalizesTime(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()

	rangeValue := "2026-10-17 00:00:00 - 2026-10-17 23:59:59"
	page, err := client.NewProtocol().ListLogs(ctx, LogListRequest{
		Page: 1, Size: 20, JobGroup: 1, JobID: 0, LogStatus: LogStatusAll, FilterTime: rangeValue,
	})
	if err != nil {
		t.Fatalf("ListLogs: %v", err)
	}
	call, _ := admin.lastCallTo(routeJobLogPageList)
	if got := call.Form.Get("filterTime"); got != rangeValue {
		t.Errorf("filterTime = %q, want %q", got, rangeValue)
	}
	if got := call.Form.Get("logStatus"); got != "-1" {
		t.Errorf("logStatus = %q, want -1", got)
	}
	// jobId 0 means "all tasks" and must be sent explicitly.
	if got := call.Form.Get("jobId"); got != "0" {
		t.Errorf("jobId = %q, want 0", got)
	}
	if len(page.Rows) != 1 {
		t.Fatalf("rows = %+v", page.Rows)
	}
	row := page.Rows[0]
	if !row.IsRunning() {
		t.Errorf("triggerCode 200 with handleCode 0 should read as running: %+v", row)
	}
	// 2.x sends handleTime as a formatted string, 3.3+ as epoch millis; the
	// model normalizes both to one shape.
	if row.HandleTime.String() == "" {
		t.Error("HandleTime should be normalized to a non-empty string")
	}
}

func TestNormalizeFilterTimeDropsMalformedRange(t *testing.T) {
	cases := map[string]string{
		"":                                 "",
		"2026-10-17 00:00:00":              "",
		"2026-10-17 00:00:00 - 2026-10-17": "2026-10-17 00:00:00 - 2026-10-17",
	}
	for input, want := range cases {
		if got := normalizeFilterTime(input); got != want {
			t.Errorf("normalizeFilterTime(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestLogDetailDecodesIncrementalSlice(t *testing.T) {
	admin := newFakeAdmin(t, flavor35, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()

	detail, err := client.NewProtocol().LogDetail(ctx, 10, 5)
	if err != nil {
		t.Fatalf("LogDetail: %v", err)
	}
	if detail.FromLineNum != 1 || detail.ToLineNum != 2 || !detail.IsEnd {
		t.Fatalf("detail = %+v", detail)
	}
	call, _ := admin.lastCallTo(routeJobLogDetailCat)
	if got := call.Form.Get("fromLineNum"); got != "5" {
		t.Errorf("fromLineNum = %q, want 5", got)
	}
}

func TestLogKillSucceedsAndReportsForwardFailure(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()
	protocol := client.NewProtocol()

	if err := protocol.LogKill(ctx, 10); err != nil {
		t.Fatalf("LogKill: %v", err)
	}
	call, _ := admin.lastCallTo(routeJobLogKill)
	if got := call.Form.Get("id"); got != "10" {
		t.Errorf("logKill id = %q, want 10", got)
	}

	// An unreachable executor must be reported as a forwarding failure rather
	// than as an opaque remote error.
	admin.failExecutorForward("read timed out: executor 172.23.0.5:9999")
	if err := protocol.LogKill(ctx, 10); !errors.Is(err, ErrExecutorForward) {
		t.Fatalf("LogKill error = %v, want ErrExecutorForward", err)
	}
	if err := protocol.LogKill(ctx, 10); errors.Is(err, ErrRemote) {
		t.Fatal("a forwarding failure must not be reported as a plain remote error")
	}
}

func TestLogDetailReportsForwardFailure(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()

	admin.failExecutorForward("connect refused")
	if _, err := client.NewProtocol().LogDetail(ctx, 10, 1); !errors.Is(err, ErrExecutorForward) {
		t.Fatalf("error = %v, want ErrExecutorForward", err)
	}
}

func TestLoadJobGroupReadsSingleRow(t *testing.T) {
	admin := newFakeAdmin(t, flavor35, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()

	group, err := client.NewProtocol().LoadJobGroup(ctx, 1)
	if err != nil {
		t.Fatalf("LoadJobGroup: %v", err)
	}
	if group.AppName != "xxl-job-executor-sample" {
		t.Errorf("appName = %q", group.AppName)
	}
	if len(group.RegistryList) != 1 {
		t.Fatalf("registryList = %+v", group.RegistryList)
	}
	if group.RegistryList[0].RegistryKey == "" {
		t.Error("expected the registered node address")
	}
}
