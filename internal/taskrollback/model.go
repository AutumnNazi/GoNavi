package taskrollback

import "errors"

type Kind string

const (
	KindSQLImport   Kind = "sql_import"
	KindTableImport Kind = "table_import"
	KindDataSync    Kind = "data_sync"
)

type Status string

const (
	StatusWriting  Status = "writing"
	StatusReady    Status = "ready"
	StatusRestored Status = "restored"
)

var (
	ErrNotFound  = errors.New("task rollback point not found")
	ErrExists    = errors.New("task rollback point already exists")
	ErrNotReady  = errors.New("task rollback point is not ready")
	ErrBusy      = errors.New("task rollback is already running")
	ErrInvalidID = errors.New("invalid task rollback id")
)

// Object is one target the task may change. Existed is false when the object
// was absent before the task; rollback drops it if the task created it.
type Object struct {
	Name    string `json:"name"`
	Existed bool   `json:"existed"`
	IsView  bool   `json:"isView,omitempty"`
}

// Point is the pre-task snapshot. The SQL file lives beside this metadata and
// is not embedded, so a large dump is not loaded into the index.
type Point struct {
	ID            string   `json:"id"`
	Kind          Kind     `json:"kind"`
	TaskID        string   `json:"taskId"`
	ConnectionID  string   `json:"connectionId,omitempty"`
	DBType        string   `json:"dbType,omitempty"`
	Database      string   `json:"database"`
	Schema        string   `json:"schema,omitempty"`
	WholeDatabase bool     `json:"wholeDatabase,omitempty"`
	Objects       []Object `json:"objects,omitempty"`
	Status        Status   `json:"status"`
	Bytes         int64    `json:"bytes,omitempty"`
	CreatedAt     int64    `json:"createdAt"`
	RestoredAt    int64    `json:"restoredAt,omitempty"`
}
