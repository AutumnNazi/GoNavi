package market

import (
	"context"
	"time"
)

// CatalogRepository exposes only published resources and transactional ratings.
type CatalogRepository interface {
	Catalog(context.Context, CatalogQuery) (CatalogPage, error)
	Plugin(context.Context, string) (MarketPlugin, error)
	Versions(context.Context, string) ([]MarketPlugin, error)
	Artifact(context.Context, string, string, string) (Artifact, error)
	PublishedArtifact(context.Context, string) (Artifact, error)
	CountDownload(context.Context, string) error
	Ratings(context.Context, string) ([]Rating, error)
	PutRating(context.Context, Account, Rating) (Rating, error)
	DeleteRating(context.Context, Account, string) error
	Report(context.Context, Account, Report) error
}

// ReviewRepository enforces publisher ownership and version transition invariants.
type ReviewRepository interface {
	BeginSubmission(context.Context, Account, string, string) (Submission, error)
	AdvanceSubmission(context.Context, Account, string, string, string) (Submission, error)
	ValidateSubmission(context.Context, Account, string, ValidatedPackage) (Submission, error)
	SelfPublish(context.Context, Account, string) (Submission, error)
	SourcePlugins(context.Context) ([]SourcePlugin, error)
	SetPluginSource(context.Context, Account, string, string) error
	Submissions(context.Context, Account) ([]Submission, error)
	SubmissionDetail(context.Context, Account, string) (ReviewDetail, error)
	Review(context.Context, Account, string, string, string) (Submission, error)
	Audits(context.Context, Account) ([]Audit, error)
	HideRating(context.Context, Account, string, string, string) error
}

// PublisherRepository scopes the author workspace to plugins the caller owns.
type PublisherRepository interface {
	PublisherPlugins(context.Context, Account, PublisherQuery) (PublisherPluginPage, error)
	PublisherSubmissions(context.Context, Account, PublisherQuery) (PublisherSubmissionPage, error)
	ClearPluginSource(context.Context, Account, string) error
	DeletePlugin(context.Context, Account, string) error
}

// AuthFlow is a single-use, short-lived website GitHub OAuth transaction.
// The legacy user_code/account_id columns remain in the schema unused.
type AuthFlow struct {
	Hash, Kind, Verifier string
	ExpiresAt            time.Time
}

// AuthRepository supports shared replica-safe authentication and revocation.
type AuthRepository interface {
	UpsertIdentity(context.Context, Identity) (Account, error)
	Session(context.Context, string, time.Time) (Account, error)
	CreateSession(context.Context, string, string, time.Time) error
	RevokeSession(context.Context, string) error
	CreateFlow(context.Context, AuthFlow) error
	ConsumeFlow(context.Context, string, string, time.Time) (AuthFlow, error)
}

// Repository combines the independently scoped service repositories.
type Repository interface {
	CatalogRepository
	ReviewRepository
	AuthRepository
	PublisherRepository
}

// PublisherQuery is one bounded owner-scoped page with an optional plugin filter.
type PublisherQuery struct {
	PluginID string
	Limit    int
	Offset   int
}
