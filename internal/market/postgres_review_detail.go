package market

import "context"

// SubmissionDetail provides exact validated bytes and manifest to administrators only.
func (p *Postgres) SubmissionDetail(ctx context.Context, a Account, id string) (ReviewDetail, error) {
	if a.Role != "admin" {
		return ReviewDetail{}, ErrForbidden
	}
	var detail ReviewDetail
	var manifest []byte
	var size int64
	s := &detail.Submission
	err := p.db.QueryRowContext(ctx, "SELECT "+submissionColumns+",v.manifest,v.size_bytes FROM market_versions v JOIN market_plugins p ON p.id=v.plugin_id WHERE v.id=$1", id).Scan(
		&s.ID, &s.PluginID, &s.Version, &s.State, &s.PublisherID, &s.Reason, &s.SHA256, &s.CreatedAt, &s.UpdatedAt, &manifest, &size)
	if err != nil {
		return detail, repositoryError(err)
	}
	detail.Manifest = manifest
	if s.SHA256 != "" {
		detail.Artifact = &Artifact{SHA256: s.SHA256, SizeBytes: size, Version: s.Version, Platform: "any"}
	}
	return detail, nil
}
