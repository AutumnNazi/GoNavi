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
	Submissions(context.Context, Account) ([]Submission, error)
	SubmissionDetail(context.Context, Account, string) (ReviewDetail, error)
	Review(context.Context, Account, string, string, string) (Submission, error)
	Audits(context.Context, Account) ([]Audit, error)
	HideRating(context.Context, Account, string, string, string) error
}

// DeviceGrant persists authorization without storing the device's secret code.
type DeviceGrant struct {
	CodeHash, UserCodeHash, State, AccountID string
	ExpiresAt, NextPollAt                    time.Time
}

// AuthFlow is a single-use, short-lived browser OAuth/consent transaction.
type AuthFlow struct {
	Hash, Kind, Verifier, UserCode, AccountID string
	ExpiresAt                                 time.Time
}

// AuthRepository supports shared replica-safe authentication and revocation.
type AuthRepository interface {
	UpsertIdentity(context.Context, Identity) (Account, error)
	Session(context.Context, string, time.Time) (Account, error)
	RevokeSession(context.Context, string) error
	CreateDevice(context.Context, DeviceGrant) error
	PollDevice(context.Context, string, string, time.Time, time.Time) (string, error)
	DecideDevice(context.Context, string, string, bool, time.Time) error
	CreateFlow(context.Context, AuthFlow) error
	ConsumeFlow(context.Context, string, string, time.Time) (AuthFlow, error)
}

// Repository combines the independently scoped service repositories.
type Repository interface {
	CatalogRepository
	ReviewRepository
	AuthRepository
}
