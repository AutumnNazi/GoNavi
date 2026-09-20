package webserver

import (
	"net/http"
	"time"

	httpserverlimits "GoNavi-Wails/internal/httpserver"
	"GoNavi-Wails/internal/rpctimeout"
)

// wrapInvokeRoute lets SQL and other long App methods idle past
// http.Server's one-minute WriteTimeout, while still bounding actual writes.
func wrapInvokeRoute(next http.Handler) http.Handler {
	return httpserverlimits.StreamingWriteTimeout(httpserverlimits.LimitRequestBody(next))
}

func clearLongRunningInvokeWriteDeadline(w http.ResponseWriter, method string) {
	if w == nil || !rpctimeout.IsLongRunningAppMethod(method) {
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
}
