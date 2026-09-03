package tvrdkey

import (
	"context"
	"errors"
	"strings"
	"sync"
	"time"
)

const (
	MinCodeLen = 16
	MaxCodeLen = 128
	MaxKeyLen  = 512
	DefaultTTL = 10 * time.Minute
)

var (
	ErrInvalidCode = errors.New("invalid pairing code")
	ErrEmptyKey    = errors.New("api key is required")
	ErrKeyTooLong  = errors.New("api key is too long")
	ErrMissing     = errors.New("pairing session not found")
	ErrFilled      = errors.New("pairing session already has a key")
)

type Status string

const (
	StatusPending   Status = "pending"
	StatusSubmitted Status = "submitted"
	StatusMissing   Status = "missing"
)

type slot struct {
	apiKey    string
	createdAt time.Time
	waiters   []chan struct{}
}

type Store struct {
	mu    sync.Mutex
	slots map[string]*slot
	ttl   time.Duration
}

func NewStore(ttl time.Duration) *Store {
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	s := &Store{
		slots: map[string]*slot{},
		ttl:   ttl,
	}
	go s.reaper()
	return s
}

func ValidCode(code string) bool {
	n := len(code)
	if n < MinCodeLen || n > MaxCodeLen {
		return false
	}
	for i := 0; i < n; i++ {
		c := code[i]
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' {
			continue
		}
		return false
	}
	return true
}

func (s *Store) Open(code string) error {
	if !ValidCode(code) {
		return ErrInvalidCode
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if existing, ok := s.slots[code]; ok {
		s.wake(existing)
	}
	s.slots[code] = &slot{createdAt: time.Now()}
	return nil
}

func (s *Store) Status(code string) Status {
	if !ValidCode(code) {
		return StatusMissing
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	slot, ok := s.getLive(code)
	if !ok {
		return StatusMissing
	}
	if slot.apiKey != "" {
		return StatusSubmitted
	}
	return StatusPending
}

func (s *Store) Submit(code, apiKey string) error {
	if !ValidCode(code) {
		return ErrInvalidCode
	}
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return ErrEmptyKey
	}
	if len(apiKey) > MaxKeyLen {
		return ErrKeyTooLong
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	slot, ok := s.getLive(code)
	if !ok {
		return ErrMissing
	}
	if slot.apiKey != "" {
		return ErrFilled
	}
	slot.apiKey = apiKey
	s.wake(slot)
	return nil
}

func (s *Store) Wait(ctx context.Context, code string) (string, error) {
	if !ValidCode(code) {
		return "", ErrInvalidCode
	}

	ch := make(chan struct{}, 1)

	s.mu.Lock()
	slot, ok := s.getLive(code)
	if !ok {
		s.mu.Unlock()
		return "", ErrMissing
	}
	if key := slot.apiKey; key != "" {
		delete(s.slots, code)
		s.mu.Unlock()
		return key, nil
	}
	slot.waiters = append(slot.waiters, ch)
	s.mu.Unlock()

	select {
	case <-ch:
	case <-ctx.Done():
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if live, ok := s.slots[code]; ok {
		live.waiters = removeWaiter(live.waiters, ch)
	}
	slot, ok = s.getLive(code)
	if !ok {
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		return "", ErrMissing
	}
	if key := slot.apiKey; key != "" {
		delete(s.slots, code)
		return key, nil
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	return "", ErrMissing
}

func (s *Store) getLive(code string) (*slot, bool) {
	slot, ok := s.slots[code]
	if !ok {
		return nil, false
	}
	if time.Since(slot.createdAt) > s.ttl {
		s.wake(slot)
		delete(s.slots, code)
		return nil, false
	}
	return slot, true
}

func (s *Store) wake(slot *slot) {
	for _, waiter := range slot.waiters {
		select {
		case waiter <- struct{}{}:
		default:
		}
	}
	slot.waiters = nil
}

func (s *Store) reaper() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		s.mu.Lock()
		cutoff := time.Now().Add(-s.ttl)
		for code, slot := range s.slots {
			if slot.createdAt.Before(cutoff) {
				s.wake(slot)
				delete(s.slots, code)
			}
		}
		s.mu.Unlock()
	}
}

func removeWaiter(waiters []chan struct{}, target chan struct{}) []chan struct{} {
	if len(waiters) == 0 {
		return waiters
	}
	kept := waiters[:0]
	for _, waiter := range waiters {
		if waiter != target {
			kept = append(kept, waiter)
		}
	}
	return kept
}
