package xxljob

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// TimeFormat is the display form XXL-JOB uses for schedule and log timestamps.
const TimeFormat = "2006-01-02 15:04:05"

// FlexTime normalizes the three shapes XXL-JOB emits for a timestamp into one
// string: 2.x serializes java.util.Date as epoch milliseconds (or an already
// formatted string, depending on the Jackson config), 3.3+ emits a string, and
// an empty schedule yields null.
type FlexTime string

func (t *FlexTime) UnmarshalJSON(data []byte) error {
	raw := strings.TrimSpace(string(data))
	switch {
	case raw == "" || raw == "null":
		*t = ""
		return nil
	case strings.HasPrefix(raw, `"`):
		var text string
		if err := json.Unmarshal(data, &text); err != nil {
			return err
		}
		*t = FlexTime(strings.TrimSpace(text))
		return nil
	default:
		millis, err := strconv.ParseInt(raw, 10, 64)
		if err != nil {
			// A non-numeric bare token is not a timestamp we can interpret; keep
			// it verbatim rather than dropping data the operator may need.
			*t = FlexTime(raw)
			return nil
		}
		// "Never triggered" arrives as epoch 0; showing 1970 would read like a
		// real schedule that happened.
		if millis <= 0 {
			*t = ""
			return nil
		}
		*t = FlexTime(time.UnixMilli(millis).Format(TimeFormat))
		return nil
	}
}

func (t FlexTime) String() string { return string(t) }

// PageResult is the version-neutral page shape the app binding returns.
type PageResult[T any] struct {
	Page  int `json:"page"`
	Size  int `json:"size"`
	Total int `json:"total"`
	Rows  []T `json:"rows"`
}

// JobGroup is one registered (or manually entered) executor.
type JobGroup struct {
	ID           int          `json:"id"`
	AppName      string       `json:"appName"`
	Title        string       `json:"title"`
	AddressType  int          `json:"addressType"`
	AddressList  string       `json:"addressList"`
	AccessToken  string       `json:"accessToken,omitempty"`
	UpdateTime   FlexTime     `json:"updateTime,omitempty"`
	RegistryList RegistryList `json:"registryList,omitempty"`
}

// RegistryList tolerates both shapes the admin uses for the same field: the
// executor listing answers with plain executor addresses on every version we
// support, while the registry bookkeeping carries objects. Decoding strictly to
// one shape fails the whole row and takes the page down with it.
type RegistryList []RegistryNode

func (l *RegistryList) UnmarshalJSON(data []byte) error {
	if trimmed := strings.TrimSpace(string(data)); trimmed == "" || trimmed == "null" {
		*l = nil
		return nil
	}
	var items []json.RawMessage
	if err := json.Unmarshal(data, &items); err != nil {
		return err
	}
	nodes := make(RegistryList, 0, len(items))
	for _, item := range items {
		var address string
		if err := json.Unmarshal(item, &address); err == nil {
			nodes = append(nodes, RegistryNode{RegistryKey: address})
			continue
		}
		var node RegistryNode
		if err := json.Unmarshal(item, &node); err != nil {
			return err
		}
		nodes = append(nodes, node)
	}
	*l = nodes
	return nil
}

// DisplayName prefers the 3.5.0 `name` field and falls back to `title`.
func (g JobGroup) DisplayName() string {
	if name := strings.TrimSpace(g.Title); name != "" {
		return name
	}
	return strings.TrimSpace(g.AppName)
}

// RegistryNode is one executor address reported through auto registration.
type RegistryNode struct {
	RegistryGroup string   `json:"registryGroup"`
	RegistryKey   string   `json:"registryKey"`
	UpdateTime    FlexTime `json:"updateTime,omitempty"`
}

// JobInfo is one scheduled task definition.
type JobInfo struct {
	ID                     int      `json:"id"`
	JobGroup               int      `json:"jobGroup"`
	Name                   string   `json:"name"`
	Author                 string   `json:"author,omitempty"`
	AlarmEmail             string   `json:"alarmEmail,omitempty"`
	ScheduleType           string   `json:"scheduleType,omitempty"`
	ScheduleConf           string   `json:"scheduleConf,omitempty"`
	MisfireStrategy        string   `json:"misfireStrategy,omitempty"`
	ExecutorRouteStrategy  string   `json:"executorRouteStrategy,omitempty"`
	ExecutorHandler        string   `json:"executorHandler,omitempty"`
	ExecutorParam          string   `json:"executorParam,omitempty"`
	ExecutorBlockStrategy  string   `json:"executorBlockStrategy,omitempty"`
	ExecutorTimeout        int      `json:"executorTimeout"`
	ExecutorFailRetryCount int      `json:"executorFailRetryCount"`
	GlueType               string   `json:"glueType,omitempty"`
	ChildJobID             string   `json:"childJobId,omitempty"`
	TriggerStatus          int      `json:"triggerStatus"`
	TriggerLastTime        FlexTime `json:"triggerLastTime,omitempty"`
	TriggerNextTime        FlexTime `json:"triggerNextTime,omitempty"`
}

// Stopped and Running mirror XXL-JOB's triggerStatus codes.
const (
	TriggerStatusStopped = 0
	TriggerStatusRunning = 1
)

// IsRunning reports whether the task is scheduled (as opposed to paused).
func (j JobInfo) IsRunning() bool { return j.TriggerStatus == TriggerStatusRunning }

// JobLog is one task execution record.
type JobLog struct {
	ID                    int      `json:"id"`
	JobGroup              int      `json:"jobGroup"`
	JobID                 int      `json:"jobId"`
	ExecutorAddress       string   `json:"executorAddress,omitempty"`
	ExecutorHandler       string   `json:"executorHandler,omitempty"`
	ExecutorParam         string   `json:"executorParam,omitempty"`
	ExecutorShardingParam string   `json:"executorShardingParam,omitempty"`
	TriggerTime           FlexTime `json:"triggerTime,omitempty"`
	TriggerCode           int      `json:"triggerCode"`
	TriggerMsg            string   `json:"triggerMsg,omitempty"`
	HandleTime            FlexTime `json:"handleTime,omitempty"`
	HandleCode            int      `json:"handleCode"`
	HandleMsg             string   `json:"handleMsg,omitempty"`
	AlarmStatus           int      `json:"alarmStatus"`
}

// LogStatus mirrors XXL-JOB's joblog logStatus filter codes.
const (
	LogStatusAll     = -1
	LogStatusSuccess = 1
	LogStatusFailed  = 2
	LogStatusRunning = 3
)

// IsRunning reports whether the execution is still in flight, which is the only
// state where log kill is meaningful. XXL-JOB leaves handleCode at 0 until the
// executor reports completion, so 0 plus a successful dispatch means running.
func (l JobLog) IsRunning() bool {
	return l.TriggerCode == http.StatusOK && l.HandleCode == 0
}

// LogDetail is the incremental slice of an executor's rolling log.
type LogDetail struct {
	FromLineNum int    `json:"fromLineNum"`
	ToLineNum   int    `json:"toLineNum"`
	LogContent  string `json:"logContent"`
	IsEnd       bool   `json:"isEnd"`
}

// UnmarshalJSON collapses the pre-3.5.0 and post-3.5.0 executor names onto one
// field. The two shapes are decoded explicitly rather than through an embedded
// alias, because struct-tag conflicts between a promoted field and an outer one
// are resolved by depth and are easy to break by reordering.
func (g *JobGroup) UnmarshalJSON(data []byte) error {
	type plain JobGroup
	var base plain
	if err := json.Unmarshal(data, &base); err != nil {
		return err
	}
	*g = JobGroup(base)

	var alias struct {
		Name *string `json:"name"`
	}
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	if strings.TrimSpace(g.Title) == "" && alias.Name != nil {
		g.Title = strings.TrimSpace(*alias.Name)
	}
	return nil
}

// UnmarshalJSON collapses job_desc (up to 3.4.2) and name (3.5.0) onto Name.
func (j *JobInfo) UnmarshalJSON(data []byte) error {
	type plain JobInfo
	var base plain
	if err := json.Unmarshal(data, &base); err != nil {
		return err
	}
	*j = JobInfo(base)

	var alias struct {
		JobDesc *string `json:"jobDesc"`
	}
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}
	if strings.TrimSpace(j.Name) == "" && alias.JobDesc != nil {
		j.Name = strings.TrimSpace(*alias.JobDesc)
	}
	return nil
}
