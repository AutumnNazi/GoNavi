package mockdata

// 英文词库与通用后缀。

var enFirstNames = []string{
	"James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda", "William", "Elizabeth",
	"David", "Barbara", "Richard", "Susan", "Joseph", "Jessica", "Thomas", "Sarah", "Charles", "Karen",
	"Daniel", "Nancy", "Matthew", "Lisa", "Anthony", "Betty", "Mark", "Margaret", "Steven", "Sandra",
	"Paul", "Ashley", "Andrew", "Emily", "Joshua", "Donna", "Kevin", "Michelle", "Brian", "Carol",
	"George", "Amanda", "Edward", "Melissa", "Ryan", "Deborah", "Jacob", "Stephanie", "Gary", "Rebecca",
	"Nicholas", "Laura", "Eric", "Sharon", "Jonathan", "Cynthia", "Stephen", "Kathleen", "Larry", "Amy",
	"Justin", "Angela", "Scott", "Anna", "Brandon", "Ruth", "Benjamin", "Brenda", "Samuel", "Pamela",
	"Frank", "Nicole", "Gregory", "Katherine", "Alexander", "Samantha", "Patrick", "Christine", "Jack", "Emma",
}

var enLastNames = []string{
	"Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
	"Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
	"Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
	"Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
	"Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
	"Turner", "Phillips", "Evans", "Parker", "Edwards", "Collins", "Stewart", "Morris", "Murphy", "Cook",
}

type enState struct {
	Name   string
	Cities []string
}

var enStates = []enState{
	{Name: "California", Cities: []string{"Los Angeles", "San Francisco", "San Diego", "San Jose", "Sacramento"}},
	{Name: "Texas", Cities: []string{"Houston", "Dallas", "Austin", "San Antonio"}},
	{Name: "New York", Cities: []string{"New York", "Buffalo", "Rochester", "Albany"}},
	{Name: "Florida", Cities: []string{"Miami", "Orlando", "Tampa", "Jacksonville"}},
	{Name: "Illinois", Cities: []string{"Chicago", "Springfield", "Naperville"}},
	{Name: "Washington", Cities: []string{"Seattle", "Spokane", "Tacoma"}},
	{Name: "Massachusetts", Cities: []string{"Boston", "Cambridge", "Worcester"}},
	{Name: "Colorado", Cities: []string{"Denver", "Boulder", "Aurora"}},
	{Name: "Georgia", Cities: []string{"Atlanta", "Savannah", "Augusta"}},
	{Name: "Oregon", Cities: []string{"Portland", "Eugene", "Salem"}},
}

var enStreetNames = []string{
	"Main", "Oak", "Pine", "Maple", "Cedar", "Elm", "Washington", "Lake", "Hill", "Park", "Sunset", "River",
	"Highland", "Church", "Spring", "Center", "Forest", "Meadow", "Lincoln", "Madison",
}

var enStreetSuffixes = []string{"St", "Ave", "Rd", "Blvd", "Ln", "Dr", "Way", "Ct"}

var enCompanyWords = []string{
	"Acme", "Globex", "Initech", "Umbrella", "Stark", "Wayne", "Hooli", "Vandelay", "Pied Piper", "Soylent",
	"Cyberdyne", "Tyrell", "Wonka", "Gringotts", "Aperture", "Blue Sky", "Northwind", "Contoso", "Fabrikam",
	"Silver Line", "Bright Path", "Summit", "Evergreen", "Redwood",
}

var enCompanySuffixes = []string{"Inc.", "LLC", "Ltd.", "Group", "Corp.", "Holdings", "Labs", "Technologies"}

var enTextWords = []string{
	"lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod",
	"tempor", "incididunt", "ut", "labore", "et", "dolore", "magna", "aliqua", "enim", "ad", "minim", "veniam",
	"quis", "nostrud", "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex", "ea", "commodo",
	"consequat", "duis", "aute", "irure", "in", "reprehenderit", "voluptate", "velit", "esse", "cillum",
	"fugiat", "nulla", "pariatur", "excepteur", "sint", "occaecat", "cupidatat", "non", "proident", "sunt",
	"culpa", "qui", "officia", "deserunt", "mollit", "anim", "id", "est", "laborum",
}

var emailDomains = []string{"example.com", "example.org", "example.net", "mail.test", "demo.test"}

var urlWords = []string{
	"alpha", "beta", "gamma", "nova", "pixel", "cloud", "data", "smart", "bright", "rapid", "open", "blue",
	"green", "zen", "meta", "spark", "wave", "core", "next", "prime",
}

// cnMobilePrefixes 是中国大陆手机号前三位常见号段。
var cnMobilePrefixes = []string{
	"130", "131", "132", "133", "134", "135", "136", "137", "138", "139", "145", "147", "150", "151",
	"152", "153", "155", "156", "157", "158", "159", "166", "173", "175", "176", "177", "178", "180",
	"181", "182", "183", "184", "185", "186", "187", "188", "189", "191", "198", "199",
}
