package xxljob

// Routes bound from 3.2.0 onward. Authentication moved to the xxl-sso token
// endpoints, and from 3.3.0 the task routes were renamed as well.
const (
	route3Login     = "/auth/doLogin"
	route3Logout    = "/auth/logout"
	route3LoginPage = "/auth/login"
)

// Task mutation routes for the 3.3.0+ line. These replace the 2.x /add /remove
// pair with /insert /delete, and the single-id parameter with ids[]. The admin
// restricts delete to exactly one id, so the app sends single-id batches.
const (
	route3JobInfoInsert  = "/jobinfo/insert"
	route3JobInfoUpdate  = "/jobinfo/update"
	route3JobInfoDelete  = "/jobinfo/delete"
	route3JobGroupInsert = "/jobgroup/insert"
	route3JobGroupUpdate = "/jobgroup/update"
	route3JobGroupDelete = "/jobgroup/delete"
)

// GLUE source routes. 3.x moved the source editor behind /jobcode; the source
// itself still travels inside the jobinfo POJO on insert/update.
const (
	route3JobCodeSave = "/jobcode/save"
)

// loginRoute returns the login endpoint for the detected authentication family.
func (s Stack) loginRoute() string {
	if s.Login == LoginSSO {
		return route3Login
	}
	return route2Login
}

func (s Stack) logoutRoute() string {
	if s.Login == LoginSSO {
		return route3Logout
	}
	return route2Logout
}
