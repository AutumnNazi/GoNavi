package taskrollback

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	pointFileName    = "point.json"
	snapshotFileName = "snapshot.sql"
	taskIndexDirName = "by-task"
)

var validIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`)

// Store keeps rollback points under the app config directory. Snapshot SQL
// can contain table data, so the directory is private to the local user.
type Store struct {
	root      string
	mu        sync.Mutex
	restoring map[string]struct{}
}

func Open(root string) (*Store, error) {
	root = strings.TrimSpace(root)
	if root == "" {
		return nil, errors.New("task rollback directory is empty")
	}
	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(absRoot, taskIndexDirName), 0o700); err != nil {
		return nil, err
	}
	store := &Store{root: absRoot, restoring: map[string]struct{}{}}
	store.sweepWriting()
	return store, nil
}

// Begin reserves a snapshot file. A ready point for the same task is left
// untouched so a resume cannot replace the original pre-task image.
func (s *Store) Begin(point Point) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	point.TaskID = strings.TrimSpace(point.TaskID)
	point.ID = strings.TrimSpace(point.ID)
	if !validIDPattern.MatchString(point.TaskID) || !validID(point.ID) {
		return "", ErrInvalidID
	}
	if existing, err := s.readyIDByTaskLocked(point.TaskID); err == nil && existing != "" {
		return "", ErrExists
	}
	if err := os.MkdirAll(s.pointDir(point.ID), 0o700); err != nil {
		return "", err
	}
	point.Status = StatusWriting
	point.CreatedAt = time.Now().UnixMilli()
	point.RestoredAt = 0
	point.Bytes = 0
	if err := writePointAtomic(s.pointPath(point.ID), point); err != nil {
		_ = os.RemoveAll(s.pointDir(point.ID))
		return "", err
	}
	return s.snapshotPath(point.ID), nil
}

func (s *Store) Commit(id string, bytes int64) (Point, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	point, err := s.readPointLocked(id)
	if err != nil {
		return Point{}, err
	}
	if point.Status != StatusWriting {
		return Point{}, ErrNotReady
	}
	point.Status = StatusReady
	point.Bytes = bytes
	if err := writePointAtomic(s.pointPath(point.ID), point); err != nil {
		return Point{}, err
	}
	if err := writeTaskIndex(s.taskIndexPath(point.TaskID), point.ID); err != nil {
		return Point{}, err
	}
	return point, nil
}

func (s *Store) Abort(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id = strings.TrimSpace(id)
	if !validID(id) {
		return ErrInvalidID
	}
	point, err := s.readPointLocked(id)
	if errors.Is(err, ErrNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	if point.Status == StatusReady || point.Status == StatusRestored {
		return ErrNotReady
	}
	return os.RemoveAll(s.pointDir(id))
}

func (s *Store) ReadyByTask(taskID string) (Point, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id, err := s.readyIDByTaskLocked(taskID)
	if err != nil {
		return Point{}, err
	}
	return s.readPointLocked(id)
}

func (s *Store) TryStartRestore(id string) (Point, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	id = strings.TrimSpace(id)
	if !validID(id) {
		return Point{}, ErrInvalidID
	}
	if _, running := s.restoring[id]; running {
		return Point{}, ErrBusy
	}
	point, err := s.readPointLocked(id)
	if err != nil {
		return Point{}, err
	}
	if point.Status != StatusReady {
		return Point{}, ErrNotReady
	}
	s.restoring[id] = struct{}{}
	return point, nil
}

func (s *Store) FinishRestore(id string, restored bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	id = strings.TrimSpace(id)
	delete(s.restoring, id)
	if !restored {
		return nil
	}
	point, err := s.readPointLocked(id)
	if err != nil {
		return err
	}
	point.Status = StatusRestored
	point.RestoredAt = time.Now().UnixMilli()
	return writePointAtomic(s.pointPath(id), point)
}

func (s *Store) SnapshotPath(id string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.readPointLocked(id); err != nil {
		return "", err
	}
	return s.snapshotPath(id), nil
}

func (s *Store) readyIDByTaskLocked(taskID string) (string, error) {
	taskID = strings.TrimSpace(taskID)
	if !validIDPattern.MatchString(taskID) {
		return "", ErrNotFound
	}
	payload, err := os.ReadFile(s.taskIndexPath(taskID))
	if errors.Is(err, os.ErrNotExist) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	id := strings.TrimSpace(string(payload))
	point, err := s.readPointLocked(id)
	if err != nil || point.TaskID != taskID {
		return "", ErrNotFound
	}
	if point.Status == StatusRestored {
		return "", ErrNotReady
	}
	if point.Status != StatusReady {
		return "", ErrNotFound
	}
	return point.ID, nil
}

func (s *Store) readPointLocked(id string) (Point, error) {
	id = strings.TrimSpace(id)
	if !validID(id) {
		return Point{}, ErrNotFound
	}
	payload, err := os.ReadFile(s.pointPath(id))
	if errors.Is(err, os.ErrNotExist) {
		return Point{}, ErrNotFound
	}
	if err != nil {
		return Point{}, err
	}
	var point Point
	if err := json.Unmarshal(payload, &point); err != nil {
		return Point{}, err
	}
	if point.ID == "" {
		point.ID = id
	}
	return point, nil
}

func (s *Store) sweepWriting() {
	entries, err := os.ReadDir(s.root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == taskIndexDirName {
			continue
		}
		point, err := s.readPointLocked(entry.Name())
		if err != nil || point.Status == StatusWriting {
			_ = os.RemoveAll(filepath.Join(s.root, entry.Name()))
		}
	}
}

func (s *Store) pointDir(id string) string {
	return filepath.Join(s.root, id)
}

func (s *Store) pointPath(id string) string {
	return filepath.Join(s.pointDir(id), pointFileName)
}

func (s *Store) snapshotPath(id string) string {
	return filepath.Join(s.pointDir(id), snapshotFileName)
}

func (s *Store) taskIndexPath(taskID string) string {
	return filepath.Join(s.root, taskIndexDirName, taskID)
}

func validID(id string) bool {
	return validIDPattern.MatchString(strings.TrimSpace(id))
}

func NewPointID() string {
	return uuid.NewString()
}

func writePointAtomic(path string, point Point) error {
	payload, err := json.MarshalIndent(point, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateAtomic(path, append(payload, '\n'))
}

func writeTaskIndex(path, pointID string) error {
	return writePrivateAtomic(path, []byte(pointID))
}

func writePrivateAtomic(path string, payload []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}
