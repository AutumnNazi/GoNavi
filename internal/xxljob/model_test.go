package xxljob

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestFlexTimeNormalizesEveryShape(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"epoch millis", `1758000000000`, "2025-09-16 13:20:00"},
		{"formatted string", `"2026-10-17 10:00:00"`, "2026-10-17 10:00:00"},
		{"null", `null`, ""},
		{"empty string", `""`, ""},
		// 2.x sends epoch 0 for "never triggered"; rendering it as a real
		// 1970 date would read like a schedule that actually happened.
		{"zero", `0`, ""},
		{"negative", `-1`, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var value FlexTime
			if err := json.Unmarshal([]byte(tc.raw), &value); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if value.String() != tc.want {
				t.Errorf("FlexTime(%s) = %q, want %q", tc.raw, value.String(), tc.want)
			}
		})
	}
}

func TestJobGroupAcceptsBothNameShapes(t *testing.T) {
	cases := map[string]struct {
		raw  string
		want string
	}{
		"pre-3.5.0 title": {`{"id":1,"appname":"sample","title":"Legacy"}`, "Legacy"},
		"3.5.0 name":      {`{"id":1,"appname":"sample","name":"Renamed"}`, "Renamed"},
		"title wins when both present": {
			`{"id":1,"appname":"sample","title":"Legacy","name":"Renamed"}`, "Legacy",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			var group JobGroup
			if err := json.Unmarshal([]byte(tc.raw), &group); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if group.Title != tc.want {
				t.Errorf("Title = %q, want %q", group.Title, tc.want)
			}
		})
	}
}

func TestJobInfoAcceptsBothNameShapes(t *testing.T) {
	cases := map[string]struct {
		raw  string
		want string
	}{
		"pre-3.5.0 jobDesc": {`{"id":1,"jobDesc":"Legacy"}`, "Legacy"},
		"3.5.0 name":        {`{"id":1,"name":"Renamed"}`, "Renamed"},
		"name wins when both present": {
			`{"id":1,"jobDesc":"Legacy","name":"Renamed"}`, "Renamed",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			var info JobInfo
			if err := json.Unmarshal([]byte(tc.raw), &info); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if info.Name != tc.want {
				t.Errorf("Name = %q, want %q", info.Name, tc.want)
			}
		})
	}
}

func TestJobGroupDisplayNameFallsBackToAppName(t *testing.T) {
	group := JobGroup{AppName: "sample"}
	if group.DisplayName() != "sample" {
		t.Errorf("DisplayName = %q, want sample", group.DisplayName())
	}
	group.Title = "Executor"
	if group.DisplayName() != "Executor" {
		t.Errorf("DisplayName = %q, want Executor", group.DisplayName())
	}
}

func TestJobLogIsRunningOnlyWhileUnreported(t *testing.T) {
	running := JobLog{TriggerCode: 200, HandleCode: 0}
	if !running.IsRunning() {
		t.Error("a dispatched log with no handle code is still running")
	}
	if (JobLog{TriggerCode: 500, HandleCode: 0}).IsRunning() {
		t.Error("a failed dispatch is not running")
	}
	if (JobLog{TriggerCode: 200, HandleCode: 200}).IsRunning() {
		t.Error("a completed success is not running")
	}
}

func TestDecodePageHandlesBothShells(t *testing.T) {
	cases := []struct {
		name      string
		payload   string
		wantTotal int
		wantRows  int
	}{
		{"2.x shell", `{"recordsTotal":42,"recordsFiltered":7,"data":[{"id":1},{"id":2}]}`, 42, 2},
		{"3.3+ shell", `{"offset":20,"pagesize":10,"total":42,"data":[{"id":3}]}`, 42, 1},
		{"bare array", `[{"id":9}]`, 1, 1},
		{"empty", `null`, 0, 0},
		{"zero total", `{"recordsTotal":0,"recordsFiltered":0,"data":[]}`, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			result, err := decodePage[JobGroup]([]byte(tc.payload))
			if err != nil {
				t.Fatalf("decodePage: %v", err)
			}
			if result.Total != tc.wantTotal {
				t.Errorf("Total = %d, want %d", result.Total, tc.wantTotal)
			}
			if len(result.Rows) != tc.wantRows {
				t.Errorf("rows = %d, want %d", len(result.Rows), tc.wantRows)
			}
			if result.Rows == nil {
				t.Error("Rows must never be nil so JSON encodes as [] not null")
			}
		})
	}
}

func TestDecodePageDerivesPageIndexOnlyWhenPageSizeKnown(t *testing.T) {
	fromThree, err := decodePage[JobGroup]([]byte(`{"offset":20,"pagesize":10,"total":3,"data":[]}`))
	if err != nil {
		t.Fatalf("decodePage: %v", err)
	}
	if fromThree.Page != 3 {
		t.Errorf("Page = %d, want 3", fromThree.Page)
	}

	fromTwo, err := decodePage[JobGroup]([]byte(`{"recordsTotal":3,"data":[]}`))
	if err != nil {
		t.Fatalf("decodePage: %v", err)
	}
	if fromTwo.Page != 1 {
		t.Errorf("Page = %d, want 1 when the payload carries no pagesize", fromTwo.Page)
	}
}

func TestFamilyLabel(t *testing.T) {
	cases := map[Stack]string{
		{Login: LoginLegacy, Pagination: PageStartLength, Fields: FieldLegacy}:    "2.x",
		{Login: LoginSSO, Pagination: PageStartLength, Fields: FieldLegacy}:       "3.2.x",
		{Login: LoginSSO, Pagination: PageOffsetPageSize, Fields: FieldRenamed}:   "3.3+",
		{Login: LoginLegacy, Pagination: PageOffsetPageSize, Fields: FieldLegacy}: "2.x/3.3+",
		{}: "unknown",
	}
	for stack, want := range cases {
		if got := stack.FamilyLabel(); got != want {
			t.Errorf("FamilyLabel(%+v) = %q, want %q", stack, got, want)
		}
	}
}

func TestStackLoginRoutes(t *testing.T) {
	legacy := Stack{Login: LoginLegacy}
	if legacy.loginRoute() != "/login" || legacy.logoutRoute() != "/logout" {
		t.Error("legacy stack must use the /login and /logout routes")
	}
	sso := Stack{Login: LoginSSO}
	if sso.loginRoute() != "/auth/doLogin" || sso.logoutRoute() != "/auth/logout" {
		t.Error("sso stack must use the /auth routes")
	}
}

func TestNormalizePageAndSize(t *testing.T) {
	if got := normalizePage(0); got != 1 {
		t.Errorf("normalizePage(0) = %d, want 1", got)
	}
	if got := normalizePageSize(0); got != defaultPageSize {
		t.Errorf("normalizePageSize(0) = %d, want %d", got, defaultPageSize)
	}
	if got := normalizePageSize(maxPageSize + 50); got != maxPageSize {
		t.Errorf("normalizePageSize overflow = %d, want %d", got, maxPageSize)
	}
}

func TestClassifyPagePayload(t *testing.T) {
	cases := []struct {
		name       string
		payload    string
		wantPaging PaginationFamily
		wantFields FieldEra
	}{
		{
			name:       "2.x row shape",
			payload:    `{"recordsTotal":1,"data":[{"id":1,"appname":"a","title":"t"}]}`,
			wantPaging: PageStartLength, wantFields: FieldLegacy,
		},
		{
			name:       "3.5.0 row shape",
			payload:    `{"total":1,"data":[{"id":1,"appname":"a","name":"n"}]}`,
			wantPaging: PageOffsetPageSize, wantFields: FieldRenamed,
		},
		{
			name:       "3.5.0 paging with an empty list cannot reveal the field era",
			payload:    `{"total":0,"data":[]}`,
			wantPaging: PageOffsetPageSize, wantFields: FieldLegacy,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			paging, fields := classifyPagePayload([]byte(tc.payload))
			if paging != tc.wantPaging {
				t.Errorf("paging = %q, want %q", paging, tc.wantPaging)
			}
			if fields != tc.wantFields {
				t.Errorf("fields = %q, want %q", fields, tc.wantFields)
			}
		})
	}
}

func TestJobGroupAcceptsBothRegistryListShapes(t *testing.T) {
	// 2.5.0 and 3.5.0 alike answer the executor listing with plain addresses,
	// while registry bookkeeping carries objects. A strict decode of one shape
	// fails the whole row and takes the executor page down with it.
	cases := []struct {
		name string
		raw  string
		want RegistryList
	}{
		{
			name: "address strings",
			raw:  `{"id":1,"registryList":["http://10.0.0.1:9999/","http://10.0.0.2:9999/"]}`,
			want: RegistryList{{RegistryKey: "http://10.0.0.1:9999/"}, {RegistryKey: "http://10.0.0.2:9999/"}},
		},
		{
			name: "registry objects",
			raw:  `{"id":1,"registryList":[{"registryGroup":"g","registryKey":"http://10.0.0.1:9999/"}]}`,
			want: RegistryList{{RegistryGroup: "g", RegistryKey: "http://10.0.0.1:9999/"}},
		},
		{name: "null", raw: `{"id":1,"registryList":null}`, want: nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var group JobGroup
			if err := json.Unmarshal([]byte(tc.raw), &group); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if len(group.RegistryList) != len(tc.want) {
				t.Fatalf("registry length = %d, want %d", len(group.RegistryList), len(tc.want))
			}
			for i := range tc.want {
				if group.RegistryList[i] != tc.want[i] {
					t.Errorf("registry[%d] = %+v, want %+v", i, group.RegistryList[i], tc.want[i])
				}
			}
		})
	}
}

func TestAdminEnvelopeTreatsABarePayloadAsSuccess(t *testing.T) {
	// The 2.x paging routes answer with the DataTables object at the top level
	// and no envelope at all; reading that as code 0 reported a healthy
	// connection as an admin error.
	var bare adminEnvelope
	if err := json.Unmarshal([]byte(`{"recordsTotal":2,"data":[]}`), &bare); err != nil {
		t.Fatalf("unmarshal bare payload: %v", err)
	}
	if !bare.succeeded() {
		t.Error("a payload without an envelope should count as success")
	}
	if bare.code() != http.StatusOK {
		t.Errorf("code() = %d, want %d", bare.code(), http.StatusOK)
	}

	var failed adminEnvelope
	if err := json.Unmarshal([]byte(`{"code":500,"msg":"boom"}`), &failed); err != nil {
		t.Fatalf("unmarshal failure envelope: %v", err)
	}
	if failed.succeeded() {
		t.Error("code 500 should not count as success")
	}
	if failed.code() != 500 {
		t.Errorf("code() = %d, want 500", failed.code())
	}
}
