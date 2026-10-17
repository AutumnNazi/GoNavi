package xxljob

// Routes bound by the 2.3.1-3.1.0 line. These versions authenticate with a
// self-contained cookie and use the /add /remove /save task routes.
const (
	route2Login     = "/login"
	route2Logout    = "/logout"
	route2LoginPage = "/toLogin"
)

// Task mutation routes for the 2.x line. The first version ships no task
// editor, so these are declared here to keep the version difference isolated
// and to leave the second-phase editor a single place to wire up.
const (
	route2JobInfoAdd    = "/jobinfo/add"
	route2JobInfoRemove = "/jobinfo/remove"
	route2JobInfoSave   = "/jobinfo/save"
	route2JobGroupSave  = "/jobgroup/save"
	route2JobLogClear   = "/joblog/clearLog"
)
