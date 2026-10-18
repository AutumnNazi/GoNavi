package xxljob

import (
	"testing"
)

// sampleJobMutation is the full form payload the editor sends.
func sampleJobMutation() JobMutation {
	return JobMutation{
		JobGroup:               1,
		Name:                   "demo task",
		Author:                 "admin",
		AlarmEmail:             "ops@example.com",
		ScheduleType:           "CRON",
		ScheduleConf:           "0/30 * * * * ?",
		MisfireStrategy:        "DO_NOTHING",
		ExecutorRouteStrategy:  "FIRST",
		ExecutorHandler:        "demoJobHandler",
		ExecutorParam:          "p=1",
		ExecutorBlockStrategy:  "SERIAL_EXECUTION",
		ExecutorTimeout:        30,
		ExecutorFailRetryCount: 2,
		GlueType:               "BEAN",
		GlueSource:             "",
		GlueRemark:             "",
		ChildJobID:             "4",
		TriggerStatus:          0,
	}
}

func sampleGroupMutation() GroupMutation {
	return GroupMutation{
		AppName:     "xxl-job-executor-sample",
		Title:       "Sample Executor",
		AddressType: 1,
		AddressList: "http://172.23.0.5:9999/",
	}
}

func mutateProtocolForFlavor(t *testing.T, flavor adminFlavor) (Protocol, *fakeAdmin) {
	t.Helper()
	admin := newFakeAdmin(t, flavor, "")
	client, _ := mustConnectFake(t, admin)
	return client.NewProtocol(), admin
}

func TestCreateJobSendsOfficialFieldsPerStack(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			protocol, admin := mutateProtocolForFlavor(t, flavor)
			id, err := protocol.CreateJob(t.Context(), sampleJobMutation())
			if err != nil {
				t.Fatalf("CreateJob: %v", err)
			}
			if id != 3 {
				t.Fatalf("created id = %d, want 3", id)
			}
			route := flavor.jobCreateRoute()
			call, ok := admin.lastCallTo(route)
			if !ok {
				t.Fatalf("no %s call recorded", route)
			}
			form := call.Form
			// The description column is the only field the eras renamed.
			if flavor.fields == FieldRenamed {
				if got := form.Get("name"); got != "demo task" {
					t.Errorf("name = %q, want demo task", got)
				}
				if form.Has("jobDesc") {
					t.Errorf("renamed era must not send jobDesc")
				}
			} else {
				if got := form.Get("jobDesc"); got != "demo task" {
					t.Errorf("jobDesc = %q, want demo task", got)
				}
			}
			for key, want := range map[string]string{
				"jobGroup":               "1",
				"author":                 "admin",
				"alarmEmail":             "ops@example.com",
				"scheduleType":           "CRON",
				"scheduleConf":           "0/30 * * * * ?",
				"misfireStrategy":        "DO_NOTHING",
				"executorRouteStrategy":  "FIRST",
				"executorHandler":        "demoJobHandler",
				"executorParam":          "p=1",
				"executorBlockStrategy":  "SERIAL_EXECUTION",
				"executorTimeout":        "30",
				"executorFailRetryCount": "2",
				"glueType":               "BEAN",
				"childJobId":             "4",
				"triggerStatus":          "0",
			} {
				if got := form.Get(key); got != want {
					t.Errorf("%s = %q, want %q", key, got, want)
				}
			}
		})
	}
}

func TestUpdateJobCarriesID(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			protocol, admin := mutateProtocolForFlavor(t, flavor)
			job := sampleJobMutation()
			job.ID = 3
			if err := protocol.UpdateJob(t.Context(), job); err != nil {
				t.Fatalf("UpdateJob: %v", err)
			}
			route := flavor.jobUpdateRoute()
			call, ok := admin.lastCallTo(route)
			if !ok {
				t.Fatalf("no %s call recorded", route)
			}
			if got := call.Form.Get("id"); got != "3" {
				t.Errorf("id = %q, want 3", got)
			}
		})
	}
}

func TestDeleteJobsWalksOneCallPerID(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			protocol, admin := mutateProtocolForFlavor(t, flavor)
			if err := protocol.DeleteJobs(t.Context(), []int{3, 5}); err != nil {
				t.Fatalf("DeleteJobs: %v", err)
			}
			route := flavor.jobDeleteRoute()
			first, ok := admin.lastCallTo(route)
			if !ok {
				t.Fatalf("no %s call recorded", route)
			}
			// 3.x restricts delete to one id per call, so both stacks must send
			// single-id payloads.
			if got := first.Form.Get("id"); got != "5" && got != "3" {
				if first.Form.Get("ids[]") == "" {
					t.Errorf("delete form lacks a single id: %v", first.Form)
				}
			}
			calls := 0
			for _, c := range admin.recorded() {
				if c.Path == route {
					calls++
				}
			}
			if calls != 2 {
				t.Errorf("delete calls = %d, want 2", calls)
			}
		})
	}
}

func TestCreateJobGroupSendsOfficialFieldsPerStack(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			protocol, admin := mutateProtocolForFlavor(t, flavor)
			id, err := protocol.CreateJobGroup(t.Context(), sampleGroupMutation())
			if err != nil {
				t.Fatalf("CreateJobGroup: %v", err)
			}
			if id != 7 {
				t.Fatalf("created id = %d, want 7", id)
			}
			route := flavor.groupCreateRoute()
			call, ok := admin.lastCallTo(route)
			if !ok {
				t.Fatalf("no %s call recorded", route)
			}
			form := call.Form
			if flavor.fields == FieldRenamed {
				if got := form.Get("name"); got != "Sample Executor" {
					t.Errorf("name = %q", got)
				}
			} else {
				if got := form.Get("title"); got != "Sample Executor" {
					t.Errorf("title = %q", got)
				}
			}
			if got := form.Get("appname"); got != "xxl-job-executor-sample" {
				t.Errorf("appname = %q", got)
			}
			if got := form.Get("addressType"); got != "1" {
				t.Errorf("addressType = %q", got)
			}
			if got := form.Get("addressList"); got != "http://172.23.0.5:9999/" {
				t.Errorf("addressList = %q", got)
			}
		})
	}
}

func TestUpdateJobGroupCarriesID(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			protocol, admin := mutateProtocolForFlavor(t, flavor)
			group := sampleGroupMutation()
			group.ID = 7
			if err := protocol.UpdateJobGroup(t.Context(), group); err != nil {
				t.Fatalf("UpdateJobGroup: %v", err)
			}
			route := flavor.groupUpdateRoute()
			call, ok := admin.lastCallTo(route)
			if !ok {
				t.Fatalf("no %s call recorded", route)
			}
			if got := call.Form.Get("id"); got != "7" {
				t.Errorf("id = %q, want 7", got)
			}
		})
	}
}

func TestSaveGlueSourcePerStack(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			protocol, admin := mutateProtocolForFlavor(t, flavor)
			if err := protocol.SaveGlueSource(t.Context(), 1, "print('hi')", "demo"); err != nil {
				t.Fatalf("SaveGlueSource: %v", err)
			}
			if flavor.login == LoginSSO {
				call, ok := admin.lastCallTo(route3JobCodeSave)
				if !ok {
					t.Fatalf("no %s call recorded", route3JobCodeSave)
				}
				if got := call.Form.Get("glueSource"); got != "print('hi')" {
					t.Errorf("glueSource = %q", got)
				}
				if got := call.Form.Get("glueRemark"); got != "demo" {
					t.Errorf("glueRemark = %q", got)
				}
				return
			}
			// 2.x has no dedicated route: the save must ride the update POJO.
			route := flavor.jobUpdateRoute()
			call, ok := admin.lastCallTo(route)
			if !ok {
				t.Fatalf("no %s call recorded", route)
			}
			if got := call.Form.Get("glueSource"); got != "print('hi')" {
				t.Errorf("glueSource = %q", got)
			}
		})
	}
}

func TestJobMutationValidation(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*JobMutation)
		field  string
	}{
		{"missing group", func(m *JobMutation) { m.JobGroup = 0 }, "jobGroup"},
		{"missing name", func(m *JobMutation) { m.Name = " " }, "name"},
		{"missing scheduleType", func(m *JobMutation) { m.ScheduleType = "" }, "scheduleType"},
		{"missing scheduleConf", func(m *JobMutation) { m.ScheduleConf = "" }, "scheduleConf"},
		{"missing handler", func(m *JobMutation) { m.ExecutorHandler = "" }, "executorHandler"},
		{"timeout below -1", func(m *JobMutation) { m.ExecutorTimeout = -2 }, "executorTimeout"},
		{"retry below -1", func(m *JobMutation) { m.ExecutorFailRetryCount = -2 }, "executorFailRetryCount"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			job := sampleJobMutation()
			tc.mutate(&job)
			err := job.validate()
			if err == nil {
				t.Fatalf("expected validation error for %s", tc.field)
			}
		})
	}
	// NONE schedules carry no conf.
	job := sampleJobMutation()
	job.ScheduleType = ScheduleTypeNone
	job.ScheduleConf = ""
	// -1 是官方「沿用默认」语义，必须放行。
	job.ExecutorTimeout = -1
	job.ExecutorFailRetryCount = -1
	if err := job.validate(); err != nil {
		t.Errorf("NONE schedule and -1 defaults must pass, got %v", err)
	}
}

func TestGroupMutationValidation(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*GroupMutation)
	}{
		{"short appname", func(g *GroupMutation) { g.AppName = "abc" }},
		{"long appname", func(g *GroupMutation) { g.AppName = string(make([]byte, 65)) }},
		{"appname angle bracket", func(g *GroupMutation) { g.AppName = "abc<def" }},
		{"missing title", func(g *GroupMutation) { g.Title = "" }},
		{"manual without addresses", func(g *GroupMutation) { g.AddressList = "" }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			group := sampleGroupMutation()
			tc.mutate(&group)
			if err := group.validate(); err == nil {
				t.Fatalf("expected validation error for %s", tc.name)
			}
		})
	}
	group := sampleGroupMutation()
	group.AddressType = 0
	group.AddressList = ""
	if err := group.validate(); err != nil {
		t.Errorf("auto registration without addressList must pass, got %v", err)
	}
}
