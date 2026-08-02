package resolvejobs

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/resolver"
)

type Status string

const (
	StatusQueued  Status = "queued"
	StatusRunning Status = "running"
	StatusReady   Status = "ready"
	StatusFailed  Status = "failed"
)

type Job struct {
	ID        string                 `json:"jobId"`
	Status    Status                 `json:"status"`
	Progress  string                 `json:"progress,omitempty"`
	Result    *resolver.StreamResult `json:"result,omitempty"`
	Error     string                 `json:"error,omitempty"`
	ErrorCode string                 `json:"code,omitempty"`
	CreatedAt time.Time              `json:"createdAt"`
	UpdatedAt time.Time              `json:"updatedAt"`
}

type Runner func(
	ctx context.Context,
	req resolver.ResolveRequest,
	onProgress func(string),
) (*resolver.StreamResult, error)

type Store struct {
	mu   sync.Mutex
	jobs map[string]*Job
	ttl  time.Duration
}

func NewStore(ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	s := &Store{
		jobs: map[string]*Job{},
		ttl:  ttl,
	}
	go s.reaper()
	return s
}

func (s *Store) Start(timeout time.Duration, req resolver.ResolveRequest, run Runner) *Job {
	now := time.Now()
	job := &Job{
		ID:        newID(),
		Status:    StatusQueued,
		Progress:  "Queued",
		CreatedAt: now,
		UpdatedAt: now,
	}
	s.mu.Lock()
	s.jobs[job.ID] = job
	s.mu.Unlock()

	go func() {
		s.set(job.ID, func(j *Job) {
			j.Status = StatusRunning
			j.Progress = "Starting resolve…"
		})

		jobCtx, cancel := context.WithTimeout(context.Background(), timeout)
		defer cancel()

		result, err := run(jobCtx, req, func(progress string) {
			s.set(job.ID, func(j *Job) {
				j.Progress = progress
			})
		})
		if err != nil {
			code, message := splitResolveError(err)
			s.set(job.ID, func(j *Job) {
				j.Status = StatusFailed
				j.Error = message
				j.ErrorCode = code
				j.Progress = message
			})
			return
		}
		s.set(job.ID, func(j *Job) {
			j.Status = StatusReady
			j.Result = result
			j.Progress = "Stream ready"
			j.Error = ""
			j.ErrorCode = ""
		})
	}()

	return cloneJob(job)
}

func (s *Store) Get(id string) (*Job, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return nil, false
	}
	return cloneJob(job), true
}

func (s *Store) set(id string, mutate func(*Job)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job, ok := s.jobs[id]
	if !ok {
		return
	}
	mutate(job)
	job.UpdatedAt = time.Now()
}

func (s *Store) reaper() {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-s.ttl)
		s.mu.Lock()
		for id, job := range s.jobs {
			if job.UpdatedAt.Before(cutoff) {
				delete(s.jobs, id)
			}
		}
		s.mu.Unlock()
	}
}

func cloneJob(job *Job) *Job {
	copied := *job
	if job.Result != nil {
		resultCopy := *job.Result
		if job.Result.Files != nil {
			files := make([]resolver.StreamFile, len(job.Result.Files))
			copy(files, job.Result.Files)
			resultCopy.Files = files
		}
		copied.Result = &resultCopy
	}
	return &copied
}

func newID() string {
	var b [16]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func splitResolveError(err error) (code, message string) {
	if err == nil {
		return "no_links", "unknown error"
	}
	var resolveErr *resolver.ResolveError
	if errors.As(err, &resolveErr) {
		return resolveErr.Code, resolveErr.Message
	}
	return "no_links", err.Error()
}
