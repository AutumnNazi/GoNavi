package plugin

import (
	"context"
	"fmt"
	"os"
	"time"
)

const skillReadTimeout = 10 * time.Second

type skillReadLease struct {
	instance *instance
	record   record
	skill    Skill
	capture  string
}
type verifiedSkillRead struct {
	inspection Inspection
	content    []byte
}

// ReadSkillGeneration loads only a declared document from an already-owned live generation.
// It never starts a runtime, enables a package, executes code, follows document links,
// or grants prompt/tool authority. Returned bytes are captured in the package hash scan.
func (m *Manager) ReadSkillGeneration(ctx context.Context, id string, generation uint64, skillID, digest string) (SkillContent, error) {
	if ctx == nil {
		return SkillContent{}, fmt.Errorf("skill read requires context")
	}
	if err := ctx.Err(); err != nil {
		return SkillContent{}, err
	}
	lease, err := m.acquireSkillRead(id, generation, skillID, digest)
	if err != nil {
		return SkillContent{}, err
	}
	defer m.releaseSkillRead(lease)
	budget := m.opts.InvocationTimeout
	if budget > skillReadTimeout {
		budget = skillReadTimeout
	}
	request, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	stop := context.AfterFunc(lease.instance.ctx, cancel)
	defer stop()
	verified, err := m.verifySkillPackage(request, lease)
	if err != nil {
		return SkillContent{}, err
	}
	return m.completeSkillRead(request, lease, verified)
}

func (m *Manager) acquireSkillRead(id string, generation uint64, skillID, digest string) (skillReadLease, error) {
	var empty skillReadLease
	if generation == 0 || m.opts.Disabled || !m.OwnsRuntime() {
		return empty, ErrDisabled
	}
	if !validDigest(digest) {
		return empty, ErrDigestMismatch
	}
	if !skillIDPattern.MatchString(skillID) {
		return empty, ErrNotFound
	}
	state, err := m.loadState()
	if err != nil {
		return empty, err
	}
	r, ok := state.Records[id]
	if !ok {
		return empty, ErrNotFound
	}
	if !r.DesiredEnabled || r.State != StateRunning || r.Quarantined || r.Removing || r.Generation != generation || dependencyReason(r, state.Records) != "" {
		return empty, ErrDisabled
	}
	if r.Digest != digest {
		return empty, ErrDigestMismatch
	}
	skill, err := declaredSkill(r.Manifest, skillID)
	if err != nil {
		return empty, err
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.closed {
		return empty, ErrClosed
	}
	current := m.instances[id]
	if !m.started || m.owner == nil || current == nil || !current.ready || current.ctx.Err() != nil || current.record.Generation != generation || current.record.Digest != digest {
		return empty, ErrDisabled
	}
	if current.inflight >= m.opts.MaxConcurrentInvocations {
		return empty, ErrBusy
	}
	current.inflight++
	// The lease captures the declared entry so verification hashes and returns the same chunks.
	return skillReadLease{instance: current, record: r, skill: skill, capture: skill.Entry}, nil
}

func (m *Manager) releaseSkillRead(lease skillReadLease) {
	m.mu.Lock()
	lease.instance.inflight--
	m.mu.Unlock()
}

func declaredSkill(manifest Manifest, id string) (Skill, error) {
	if !hasSkillPermission(manifest) {
		return Skill{}, ErrDisabled
	}
	for _, skill := range manifest.Contributes.Skills {
		if skill.ID == id {
			return skill, nil
		}
	}
	return Skill{}, ErrNotFound
}

func (m *Manager) verifySkillPackage(ctx context.Context, lease skillReadLease) (verifiedSkillRead, error) {
	var empty verifiedSkillRead
	root, err := openPackageDirectory(ctx, m.root)
	if err != nil {
		return empty, err
	}
	defer root.Close()
	store, err := openSkillDirectory(root, "store")
	if err != nil {
		return empty, err
	}
	defer store.Close()
	directory, err := openSkillDirectory(store, lease.record.Digest)
	if err != nil {
		return empty, err
	}
	defer directory.Close()
	scan := &packageScan{ctx: ctx, seen: make(map[string]bool), captureSkill: lease.capture}
	if err = scan.directoryHandle(directory, ""); err != nil {
		return empty, err
	}
	inspected, err := scan.finish("")
	if err != nil {
		return empty, err
	}
	if inspected.Digest != lease.record.Digest {
		return empty, ErrDigestMismatch
	}
	skill, err := declaredSkill(inspected.Manifest, lease.skill.ID)
	if err != nil {
		return empty, err
	}
	if inspected.Manifest.ID != lease.record.Manifest.ID || inspected.Manifest.Version != lease.record.Manifest.Version || !sameSkill(skill, lease.skill) {
		return empty, ErrDigestMismatch
	}
	if err = validateSkillContent(scan.skillContent); err != nil {
		return empty, err
	}
	return verifiedSkillRead{inspection: inspected, content: scan.skillContent}, nil
}

func openSkillDirectory(parent *os.File, name string) (*os.File, error) {
	file, err := openPackageChild(parent, name, true)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	if !info.IsDir() {
		file.Close()
		return nil, fmt.Errorf("skill storage component is not a directory")
	}
	return file, nil
}

func (m *Manager) completeSkillRead(ctx context.Context, lease skillReadLease, verified verifiedSkillRead) (SkillContent, error) {
	var empty SkillContent
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	state, err := m.loadState()
	if err != nil {
		return empty, err
	}
	current, ok := state.Records[lease.record.Manifest.ID]
	if !ok || !current.DesiredEnabled || current.State != StateRunning || current.Quarantined || current.Removing || current.Generation != lease.record.Generation || dependencyReason(current, state.Records) != "" {
		return empty, ErrDisabled
	}
	if current.Digest != lease.record.Digest || verified.inspection.Digest != current.Digest {
		return empty, ErrDigestMismatch
	}
	skill, err := declaredSkill(current.Manifest, lease.skill.ID)
	if err != nil {
		return empty, err
	}
	if !sameSkill(skill, lease.skill) || current.Manifest.Version != lease.record.Manifest.Version {
		return empty, ErrDigestMismatch
	}
	m.mu.Lock()
	valid := !m.closed && !m.opts.Disabled && m.started && m.owner != nil && m.instances[current.Manifest.ID] == lease.instance && lease.instance.ready && lease.instance.ctx.Err() == nil
	m.mu.Unlock()
	if !valid {
		return empty, ErrDisabled
	}
	if err := ctx.Err(); err != nil {
		return empty, err
	}
	content := SkillContent{PluginID: current.Manifest.ID, SkillID: skill.ID, Name: skill.Name, Description: skill.Description, Version: current.Manifest.Version, Digest: current.Digest, Generation: current.Generation, Content: string(verified.content)}
	if lease.capture != skill.Entry {
		content.Resource = lease.capture
	}
	return content, nil
}

// ReadSkillResourceGeneration reads one declared markdown companion. It does not
// execute the file, follow links, or make it an agent prompt.
func (m *Manager) ReadSkillResourceGeneration(ctx context.Context, id string, generation uint64, skillID, digest, resource string) (SkillContent, error) {
	if ctx == nil {
		return SkillContent{}, fmt.Errorf("skill read requires context")
	}
	lease, err := m.acquireSkillRead(id, generation, skillID, digest)
	if err != nil {
		return SkillContent{}, err
	}
	if !declaredSkillResource(lease.skill, resource) {
		m.releaseSkillRead(lease)
		return SkillContent{}, ErrNotFound
	}
	lease.capture = resource
	defer m.releaseSkillRead(lease)
	budget := m.opts.InvocationTimeout
	if budget > skillReadTimeout {
		budget = skillReadTimeout
	}
	request, cancel := context.WithTimeout(ctx, budget)
	defer cancel()
	stop := context.AfterFunc(lease.instance.ctx, cancel)
	defer stop()
	verified, err := m.verifySkillPackage(request, lease)
	if err != nil {
		return SkillContent{}, err
	}
	return m.completeSkillRead(request, lease, verified)
}

func declaredSkillResource(skill Skill, resource string) bool {
	for _, candidate := range skill.Resources {
		if candidate == resource {
			return true
		}
	}
	return false
}
