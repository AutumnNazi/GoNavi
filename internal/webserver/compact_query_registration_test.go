package webserver

import (
	"testing"

	appcore "GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/rpctimeout"
)

// The compact query transport is a second entry point to the same long-running
// query work as DBQueryMulti. It must stay registered wherever the plain
// variant is registered, otherwise web and detached-window callers inherit the
// 60s HTTP write timeout / 30s RPC deadline and lose slow query results.
func TestCompactQueryTransportStaysRegistered(t *testing.T) {
	t.Parallel()

	const compactMethod = "DBQueryMultiCompact"

	t.Run("long running allowance", func(t *testing.T) {
		if !rpctimeout.IsLongRunningAppMethod(compactMethod) {
			t.Fatalf("%s must be treated as long running", compactMethod)
		}
	})

	t.Run("database query trace ownership", func(t *testing.T) {
		request := invokeRequest{Namespace: "app", Receiver: "App", Method: compactMethod}
		if !isDatabaseQueryInvoke(request) {
			t.Fatalf("%s must own its request trace instead of the generic web one", compactMethod)
		}
		if shouldTraceWebInvoke(request) {
			t.Fatalf("%s must not create a generic web invoke trace", compactMethod)
		}
	})

	t.Run("request scoped web rpc context", func(t *testing.T) {
		registered := false
		for _, method := range appcore.RequiredIssue1098WebRPCContextMethods() {
			if method == compactMethod {
				registered = true
				break
			}
		}
		if !registered {
			t.Fatalf("%s must be registered for request-scoped context injection", compactMethod)
		}

		handlers := appcore.WebRPCContextHandlers(nil)
		if _, ok := handlers[compactMethod]; !ok {
			t.Fatalf("missing web RPC context handler for %s", compactMethod)
		}
	})
}

// The compact wrapper is a distinct result type, so the request-ID correlation
// has to reach it through the accessor probe rather than a type switch on
// connection.QueryResult.
func TestWebInvokeResultRequestIDReadsCompactQueryResult(t *testing.T) {
	t.Parallel()

	compact := appcore.CompactQueryResult{}
	compact.QueryID = "query-compact-trace"
	if got := webInvokeResultRequestID(compact); got != "query-compact-trace" {
		t.Fatalf("webInvokeResultRequestID(CompactQueryResult) = %q, want %q", got, "query-compact-trace")
	}
}
