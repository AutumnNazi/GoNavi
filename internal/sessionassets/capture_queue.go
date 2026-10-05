package sessionassets

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"
)

// EnqueueCapture 持久化一个保全意图并排入队列。请求先于复制落库，进程
// 中途退出后启动核对能识别未完成任务（FR-13）。base_generation_id 记录
// 入队时的 latest，提交时重新校验以拒绝旧任务覆盖新结果。
func (s *Service) EnqueueCapture(ctx context.Context, request CaptureRequest) (CaptureJob, error) {
	if s == nil || s.catalog == nil {
		return CaptureJob{}, ErrClosed
	}
	if err := sanitizeID(request.AssetID); err != nil {
		return CaptureJob{}, err
	}
	if request.Trigger == "" {
		request.Trigger = string(CaptureTriggerManualRetry)
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return CaptureJob{}, fmt.Errorf("encode capture request: %w", err)
	}
	now := time.Now().Unix()
	base := s.currentGenerationID(request.AssetID)
	id, err := newID()
	if err != nil {
		return CaptureJob{}, err
	}
	job := CaptureJob{
		ID: id, AssetID: request.AssetID, SourceID: request.SourceID,
		Trigger: request.Trigger, Status: string(CaptureStatusQueued),
		BaseGenerationID: base, CreatedAt: now, UpdatedAt: now,
	}
	_, err = s.catalog.db.ExecContext(ctx,
		`INSERT INTO capture_jobs (id, asset_id, source_id, trigger_kind, status, base_generation_id, request_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		job.ID, job.AssetID, job.SourceID, job.Trigger, job.Status, job.BaseGenerationID, string(payload), job.CreatedAt, job.UpdatedAt,
	)
	if err != nil {
		return CaptureJob{}, fmt.Errorf("queue capture job: %w", err)
	}
	return job, nil
}

// currentGenerationID 读取资产当前 latest 代次（无副本时为空串）。
func (s *Service) currentGenerationID(assetID string) string {
	pointer, ok, err := readCurrentPointer(s.paths.AssetDir(assetID))
	if err != nil || !ok {
		return ""
	}
	return pointer.GenerationID
}

// ClaimNextQueuedJob 认领最早的排队任务；无任务返回 ErrNotFound。
func (c *Catalog) ClaimNextQueuedJob(ctx context.Context) (CaptureJob, error) {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return CaptureJob{}, fmt.Errorf("begin claim capture job: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	var job CaptureJob
	err = tx.QueryRowContext(ctx,
		`SELECT id, asset_id, source_id, trigger_kind, status, base_generation_id, generation_id, attempt, error, created_at, updated_at
		 FROM capture_jobs WHERE status = ? ORDER BY created_at ASC LIMIT 1`,
		string(CaptureStatusQueued),
	).Scan(&job.ID, &job.AssetID, &job.SourceID, &job.Trigger, &job.Status, &job.BaseGenerationID, &job.GenerationID, &job.Attempt, &job.Error, &job.CreatedAt, &job.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptureJob{}, ErrNotFound
	}
	if err != nil {
		return CaptureJob{}, fmt.Errorf("scan queued capture job: %w", err)
	}
	job.Status = string(CaptureStatusRunning)
	job.Attempt++
	job.UpdatedAt = time.Now().Unix()
	_, err = tx.ExecContext(ctx,
		`UPDATE capture_jobs SET status = ?, attempt = ?, updated_at = ? WHERE id = ?`,
		job.Status, job.Attempt, job.UpdatedAt, job.ID)
	if err != nil {
		return CaptureJob{}, fmt.Errorf("claim capture job: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return CaptureJob{}, fmt.Errorf("commit claim capture job: %w", err)
	}
	return job, nil
}

// GetCaptureJob 按 ID 读取任务。
func (c *Catalog) GetCaptureJob(ctx context.Context, jobID string) (CaptureJob, error) {
	row := c.db.QueryRowContext(ctx,
		`SELECT id, asset_id, source_id, trigger_kind, status, base_generation_id, generation_id, attempt, error, created_at, updated_at
		 FROM capture_jobs WHERE id = ?`, jobID)
	var job CaptureJob
	err := row.Scan(&job.ID, &job.AssetID, &job.SourceID, &job.Trigger, &job.Status, &job.BaseGenerationID, &job.GenerationID, &job.Attempt, &job.Error, &job.CreatedAt, &job.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptureJob{}, ErrNotFound
	}
	if err != nil {
		return CaptureJob{}, fmt.Errorf("scan capture job: %w", err)
	}
	return job, nil
}

// LoadCaptureRequest 读取任务关联的请求。
func (c *Catalog) LoadCaptureRequest(ctx context.Context, jobID string) (CaptureRequest, error) {
	var payload string
	err := c.db.QueryRowContext(ctx,
		`SELECT request_json FROM capture_jobs WHERE id = ?`, jobID).Scan(&payload)
	if errors.Is(err, sql.ErrNoRows) {
		return CaptureRequest{}, ErrNotFound
	}
	if err != nil {
		return CaptureRequest{}, fmt.Errorf("load capture request: %w", err)
	}
	var request CaptureRequest
	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return CaptureRequest{}, fmt.Errorf("decode capture request: %w", err)
	}
	return request, nil
}

// FinishCaptureJob 写回任务的最终状态。
func (c *Catalog) FinishCaptureJob(ctx context.Context, jobID string, status CaptureStatus, generationID string, errText string) error {
	result, err := c.db.ExecContext(ctx,
		`UPDATE capture_jobs SET status = ?, generation_id = CASE WHEN ? <> '' THEN ? ELSE generation_id END,
		   error = ?, updated_at = ? WHERE id = ?`,
		string(status), generationID, generationID, errText, time.Now().Unix(), jobID)
	if err != nil {
		return fmt.Errorf("finish capture job: %w", err)
	}
	if rows, err := result.RowsAffected(); err == nil && rows == 0 {
		return ErrNotFound
	}
	return nil
}

// ListCaptureJobs 返回资产的任务历史（新在前）。
func (c *Catalog) ListCaptureJobs(ctx context.Context, assetID string) ([]CaptureJob, error) {
	rows, err := c.db.QueryContext(ctx,
		`SELECT id, asset_id, source_id, trigger_kind, status, base_generation_id, generation_id, attempt, error, created_at, updated_at
		 FROM capture_jobs WHERE asset_id = ? ORDER BY created_at DESC`, assetID)
	if err != nil {
		return nil, fmt.Errorf("list capture jobs: %w", err)
	}
	defer rows.Close()
	jobs := make([]CaptureJob, 0)
	for rows.Next() {
		var job CaptureJob
		if err := rows.Scan(&job.ID, &job.AssetID, &job.SourceID, &job.Trigger, &job.Status, &job.BaseGenerationID, &job.GenerationID, &job.Attempt, &job.Error, &job.CreatedAt, &job.UpdatedAt); err != nil {
			return nil, fmt.Errorf("scan capture job: %w", err)
		}
		jobs = append(jobs, job)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate capture jobs: %w", err)
	}
	return jobs, nil
}

// CancelQueuedJobsForAsset 把资产的排队任务置为取消（禁用与删除路径使用）。
// 正在运行的任务由 worker 自己安全结束。
func (c *Catalog) CancelQueuedJobsForAsset(ctx context.Context, assetID string) error {
	_, err := c.db.ExecContext(ctx,
		`UPDATE capture_jobs SET status = ?, error = ?, updated_at = ?
		 WHERE asset_id = ? AND status = ?`,
		string(CaptureStatusCancelled), "asset disabled or deleted", time.Now().Unix(),
		assetID, string(CaptureStatusQueued))
	if err != nil {
		return fmt.Errorf("cancel queued capture jobs: %w", err)
	}
	return nil
}

// HasActiveCaptureJob 报告资产是否已有排队或执行中的保全任务。事件重复
// 或补核对重复触发时避免创建重复任务（V-08）。
func (c *Catalog) HasActiveCaptureJob(ctx context.Context, assetID string) (bool, error) {
	var one int
	err := c.db.QueryRowContext(ctx,
		`SELECT 1 FROM capture_jobs WHERE asset_id = ? AND status IN (?, ?) LIMIT 1`,
		assetID, string(CaptureStatusQueued), string(CaptureStatusRunning)).Scan(&one)
	switch {
	case err == nil:
		return true, nil
	case errors.Is(err, sql.ErrNoRows):
		return false, nil
	default:
		return false, fmt.Errorf("check active capture job: %w", err)
	}
}
