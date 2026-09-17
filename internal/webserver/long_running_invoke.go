package webserver

import (
	"net/http"
	"time"

	"GoNavi-Wails/internal/rpctimeout"
)

func clearLongRunningInvokeWriteDeadline(w http.ResponseWriter, method string) {
	if w == nil || !rpctimeout.IsLongRunningAppMethod(method) {
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Time{})
}
