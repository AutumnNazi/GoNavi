package xxljob

// Routes bound from 3.2.0 onward. Authentication moved to the xxl-sso token
// endpoints, and from 3.3.0 the task routes were renamed as well.
const (
	route3Login     = "/auth/doLogin"
	route3Logout    = "/auth/logout"
	route3LoginPage = "/auth/login"
)

// Task mutation routes for the 3.3.0+ line. These replace the 2.x /add /remove
// pair with /insert /delete, and the single-id parameter with ids[].
const (
	route3JobInfoInsert  = "/jobinfo/insert"
	route3JobInfoDelete  = "/jobinfo/delete"
	route3JobGroupInsert = "/jobgroup/insert"
	route3JobGroupDelete = "/jobgroup/delete"
)

// Task field names after the 3.5.0 rename.
const (
	field3GroupName = "name"
	field3JobName   = "name"
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

// loginPageSuffix is what the unauthenticated redirect points at, which is how
// the first detection step tells the two authentication families apart.
func (s Stack) loginPageSuffix() string {
	if s.Login == LoginSSO {
		return route3LoginPage
	}
	return route2LoginPage
}
