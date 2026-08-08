package importjob

type Kind string

const (
	KindTable Kind = "table"
	KindSQL   Kind = "sql"
)

type Status string

const (
	StatusPreparing   Status = "preparing"
	StatusRunning     Status = "running"
	StatusStopping    Status = "stopping"
	StatusCompleted   Status = "completed"
	StatusPartial     Status = "partial"
	StatusFailed      Status = "failed"
	StatusCancelled   Status = "cancelled"
	StatusUnknown     Status = "unknown"
	StatusInterrupted Status = "interrupted"
)

type Checkpoint struct {
	Safe             bool  `json:"safe"`
	SourceRow        int64 `json:"sourceRow,omitempty"`
	ByteOffset       int64 `json:"byteOffset,omitempty"`
	StatementIndex   int64 `json:"statementIndex,omitempty"`
	TransactionStart int64 `json:"transactionStart,omitempty"`
}

type Job struct {
	ID                  string     `json:"id"`
	Kind                Kind       `json:"kind"`
	Status              Status     `json:"status"`
	Stage               string     `json:"stage,omitempty"`
	SourcePath          string     `json:"sourcePath,omitempty"`
	SourceIdentityToken string     `json:"sourceIdentityToken"`
	SourceContentSHA256 string     `json:"sourceContentSha256,omitempty"`
	TargetFingerprint   string     `json:"targetFingerprint"`
	ConnectionID        string     `json:"connectionId,omitempty"`
	DatabaseName        string     `json:"databaseName,omitempty"`
	TableName           string     `json:"tableName,omitempty"`
	OptionsHash         string     `json:"optionsHash"`
	Current             int64      `json:"current,omitempty"`
	Total               int64      `json:"total,omitempty"`
	Succeeded           int64      `json:"succeeded,omitempty"`
	Skipped             int64      `json:"skipped,omitempty"`
	Failed              int64      `json:"failed,omitempty"`
	BytesRead           int64      `json:"bytesRead,omitempty"`
	SourceBytesTotal    int64      `json:"sourceBytesTotal,omitempty"`
	ByteProgressKind    string     `json:"byteProgressKind,omitempty"`
	OutcomeUnknown      bool       `json:"outcomeUnknown,omitempty"`
	Resumable           bool       `json:"resumable,omitempty"`
	Checkpoint          Checkpoint `json:"checkpoint"`
	ErrorArtifactID     string     `json:"errorArtifactId,omitempty"`
	Message             string     `json:"message,omitempty"`
	Revision            int64      `json:"revision"`
	CreatedAt           int64      `json:"createdAt"`
	UpdatedAt           int64      `json:"updatedAt"`
}
