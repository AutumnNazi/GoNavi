package xxljob

import (
	"testing"
)

// 本文件锁住「客户端假定的响应形状与上游真实实现一致」这几条契约。
// 每条都对应一个上游 admin 的真实行为，改动客户端时必须让这些用例继续通过：

//   - 2.4.1 / 3.1.0 / 3.2.0 的分页路由返回裸 DataTables 对象，没有信封；
//   - 3.0-3.2.x 把 appname、title 声明为分页路由的必填参数；
//   - 3.2.0 的写路由仍是 add/save/remove，insert/delete 是 3.3.0 才有的。

// TestPagingReportsTheAdminTotalNotThePageLength 锁住 total 的来源。
//
// 裸 DataTables 对象的顶层 data 键是行数组，recordsTotal 与它同级。
// 只读信封里的载荷会把整个分页对象丢掉，total 退化成当前页行数，
// 前端分页因此永远只有一页。
func TestPagingReportsTheAdminTotalNotThePageLength(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, flavor, "")
			admin.setGroupsTotal(137)
			client, _ := mustConnectFake(t, admin)
			ctx, cancel := testContext(t)
			defer cancel()

			page, err := client.NewProtocol().ListJobGroups(ctx, GroupListRequest{Page: 1, Size: 10})
			if err != nil {
				t.Fatalf("ListJobGroups: %v", err)
			}
			if len(page.Rows) != 1 {
				t.Fatalf("rows = %+v", page.Rows)
			}
			if page.Total != 137 {
				t.Errorf("Total = %d, want 137 (the admin's recordsTotal, not the page length)", page.Total)
			}
		})
	}
}

// TestConnectWorksAgainstAdminsThatRequireGroupFilters 锁住版本探测的参数。
//
// 3.0-3.2.x 的 /jobgroup/pageList 把 appname 与 title 绑定为必填参数，
// 探测请求漏掉它们会被 Spring 拒成 HTTP 400，整个连接建立不起来。
func TestConnectWorksAgainstAdminsThatRequireGroupFilters(t *testing.T) {
	admin := newFakeAdmin(t, flavor32x, "")
	client, info := mustConnectFake(t, admin)

	if info.LoginFamily != string(LoginSSO) {
		t.Errorf("LoginFamily = %q, want %q", info.LoginFamily, LoginSSO)
	}
	if info.PaginationFamily != string(PageStartLength) {
		t.Errorf("PaginationFamily = %q, want %q", info.PaginationFamily, PageStartLength)
	}
	if info.FieldEra != string(FieldLegacy) {
		t.Errorf("FieldEra = %q, want %q", info.FieldEra, FieldLegacy)
	}
	if !client.Connected() {
		t.Error("client should hold a session after connecting")
	}
}

// TestDetectLoginFamilyMatchesTheLegacyLoginPage 锁住登录页探测。
//
// 2.x 的根路径重定向到 /toLogin，探测把小写化的 Location 与同样小写的
// 常量比较，才能认出 legacy 族；否则 2.x 的探测分支永远落空。
func TestDetectLoginFamilyMatchesTheLegacyLoginPage(t *testing.T) {
	admin := newFakeAdmin(t, flavor2x, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()

	family, location, err := client.DetectLoginFamily(ctx)
	if err != nil {
		t.Fatalf("DetectLoginFamily: %v", err)
	}
	if family != LoginLegacy {
		t.Errorf("family = %q, want %q", family, LoginLegacy)
	}
	if location == "" {
		t.Error("expected the admin's login redirect")
	}
}

// Test3_2_0UsesThePre3_3_MutationRoutes 锁住变更路由的版本边界。
//
// 3.2.0 已经用 SSO 登录，但写路由仍是 2.x 的 add/save/remove；
// insert/delete 是 3.3.0 才改的名。按登录族选路由会让 3.2.x 的写操作全部 404。
func Test3_2_0UsesThePre3_3_MutationRoutes(t *testing.T) {
	admin := newFakeAdmin(t, flavor32x, "")
	client, _ := mustConnectFake(t, admin)
	ctx, cancel := testContext(t)
	defer cancel()
	protocol := client.NewProtocol()

	if _, err := protocol.CreateJob(ctx, JobMutation{
		JobGroup: 1, Name: "demo", ScheduleType: "CRON", ScheduleConf: "0/30 * * * * ?",
		ExecutorHandler: "demoJobHandler", GlueType: "BEAN",
	}); err != nil {
		t.Fatalf("CreateJob: %v", err)
	}
	if _, ok := admin.lastCallTo(route2JobInfoAdd); !ok {
		t.Errorf("3.2.x must add a task through %s, got %v", route2JobInfoAdd, admin.recorded())
	}
	if _, ok := admin.lastCallTo(route3JobInfoInsert); ok {
		t.Errorf("3.2.x does not bind %s", route3JobInfoInsert)
	}

	if err := protocol.UpdateJob(ctx, JobMutation{
		ID: 1, JobGroup: 1, Name: "demo", ScheduleType: "CRON", ScheduleConf: "0/30 * * * * ?",
		ExecutorHandler: "demoJobHandler", GlueType: "BEAN",
	}); err != nil {
		t.Fatalf("UpdateJob: %v", err)
	}
	if _, ok := admin.lastCallTo(route3JobInfoUpdate); !ok {
		t.Errorf("3.2.x must update a task through %s, got %v", route3JobInfoUpdate, admin.recorded())
	}

	if err := protocol.DeleteJobs(ctx, []int{5}); err != nil {
		t.Fatalf("DeleteJobs: %v", err)
	}
	if _, ok := admin.lastCallTo(route2JobInfoRemove); !ok {
		t.Errorf("3.2.x must remove a task through %s, got %v", route2JobInfoRemove, admin.recorded())
	}
	if _, ok := admin.lastCallTo(route3JobInfoDelete); ok {
		t.Errorf("3.2.x does not bind %s", route3JobInfoDelete)
	}

	if _, err := protocol.CreateJobGroup(ctx, GroupMutation{
		AppName: "demo-executor", Title: "Demo", AddressType: 0,
	}); err != nil {
		t.Fatalf("CreateJobGroup: %v", err)
	}
	if _, ok := admin.lastCallTo(route2JobGroupSave); !ok {
		t.Errorf("3.2.x must add an executor through %s, got %v", route2JobGroupSave, admin.recorded())
	}
	if _, ok := admin.lastCallTo(route3JobGroupInsert); ok {
		t.Errorf("3.2.x does not bind %s", route3JobGroupInsert)
	}
}

// TestLoadJobByIDWalksPastTheFirstPage 锁住 GLUE 源码保存不依赖任务列表。
//
// 早先的实现要先分页找到任务再更新它，于是排在第一页之外的任务会被误判
// 成「不存在」。上游从 2.3.1 起就有 /jobcode/save，直接用它即可。
func TestSaveGlueSourceDoesNotDependOnTheTaskList(t *testing.T) {
	for _, flavor := range allFlavors {
		t.Run(flavor.name, func(t *testing.T) {
			admin := newFakeAdmin(t, flavor, "")
			// 任务列表里根本没有这个 id：保存仍必须成功，因为它不走列表。
			admin.setJobIDs([]int{1, 2, 3})
			client, _ := mustConnectFake(t, admin)
			ctx, cancel := testContext(t)
			defer cancel()

			if err := client.NewProtocol().SaveGlueSource(ctx, 9999, "print('hi')", "demo remark"); err != nil {
				t.Fatalf("SaveGlueSource: %v", err)
			}
			if _, ok := admin.lastCallTo(routeJobInfoPageList); ok {
				t.Error("saving GLUE source must not page through the task list")
			}
			if _, ok := admin.lastCallTo(route3JobCodeSave); !ok {
				t.Errorf("no %s call recorded", route3JobCodeSave)
			}
		})
	}
}
