package xxljob

// Routes bound by the 2.3.1-3.1.0 line. These versions authenticate with a
// self-contained cookie and use the /add /remove /save task routes.
const (
	route2Login     = "/login"
	route2Logout    = "/logout"
	route2LoginPage = "/toLogin"
)

// Task mutation routes for the 2.x line. The admin binds full POJOs here, so a
// save carries every field of XxlJobInfo including the GLUE source.
const (
	route2JobInfoAdd    = "/jobinfo/add"
	route2JobInfoRemove = "/jobinfo/remove"
	route2JobInfoSave   = "/jobinfo/save"
	route2JobGroupSave  = "/jobgroup/save"
	route2JobLogClear   = "/joblog/clearLog"
)

// Executor mutation routes for the 2.x line. save/update/remove mirror the
// group page's own buttons.
const (
	route2JobGroupUpdate = "/jobgroup/update"
	route2JobGroupRemove = "/jobgroup/remove"
)
