package demord

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"unicode"
)

const (
	// UserHeader identifies a demo client so play counts are per user, not global.
	UserHeader       = "X-Jedflix-Demo-User"
	DefaultPlayLimit = 5
)

var (
	ErrLimitReached = errors.New("demo play limit reached")
	ErrUnavailable  = errors.New("demo Real Debrid is not configured")
)

const LimitReachedMessage = "Demo play limit reached. Buy Real Debrid to keep watching movies, shows, and audiobooks."
const UnavailableMessage = "Demo Real Debrid is not configured on this server."

type persistedFile struct {
	Version int            `json:"version"`
	Plays   map[string]int `json:"plays"`
}

type Store struct {
	mu    sync.Mutex
	path  string
	limit int
	plays map[string]int
}

func NewStore(path string, limit int) *Store {
	if limit <= 0 {
		limit = DefaultPlayLimit
	}
	s := &Store{
		path:  strings.TrimSpace(path),
		limit: limit,
		plays: make(map[string]int),
	}
	s.load()
	return s
}

func CountsAsPlay(mediaType string) bool {
	switch strings.ToLower(strings.TrimSpace(mediaType)) {
	case "movie", "tv", "audiobook":
		return true
	default:
		return false
	}
}

func UserID(r *http.Request, fallback string) string {
	return NormalizeUserID(r.Header.Get(UserHeader), fallback)
}

func NormalizeUserID(id, fallback string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(id) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			b.WriteRune(r)
		}
	}
	out := b.String()
	if len(out) > 128 {
		out = out[:128]
	}
	if out == "" {
		return strings.TrimSpace(fallback)
	}
	return out
}

func (s *Store) Remaining(userID string) int {
	if s == nil {
		return DefaultPlayLimit
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := strings.TrimSpace(userID)
	if id == "" {
		id = "anonymous"
	}
	left := s.limit - s.plays[id]
	if left < 0 {
		return 0
	}
	return left
}

func (s *Store) Consume(userID string) error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	id := strings.TrimSpace(userID)
	if id == "" {
		id = "anonymous"
	}
	if s.plays[id] >= s.limit {
		return ErrLimitReached
	}
	s.plays[id]++
	s.persistLocked()
	return nil
}

func (s *Store) load() {
	if s.path == "" {
		return
	}
	data, err := os.ReadFile(s.path)
	if err != nil || len(data) == 0 {
		return
	}
	var file persistedFile
	if err := json.Unmarshal(data, &file); err != nil {
		return
	}
	if file.Plays == nil {
		return
	}
	s.plays = file.Plays
}

func (s *Store) persistLocked() {
	if s.path == "" {
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return
	}
	payload, err := json.Marshal(persistedFile{
		Version: 1,
		Plays:   s.plays,
	})
	if err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, payload, 0o644); err != nil {
		return
	}
	_ = os.Rename(tmp, s.path)
}

type Gate struct {
	// ClientKey is the API key users enter (REAL_DEBRID_DEMO_CLIENT_KEY); never commit it.
	ClientKey string
	ServerKey string
	Store     *Store
}

func (g *Gate) IsClientToken(token string) bool {
	if g == nil {
		return false
	}
	clientKey := strings.TrimSpace(g.ClientKey)
	if clientKey == "" {
		return false
	}
	return strings.TrimSpace(token) == clientKey
}

func (g *Gate) Configured() bool {
	return g != nil &&
		strings.TrimSpace(g.ClientKey) != "" &&
		strings.TrimSpace(g.ServerKey) != ""
}

// Apply swaps the user-facing demo token for the server RD key.
// When consume is true (resolve), a movie/show/audiobook play is counted.
func (g *Gate) Apply(token, mediaType, userID string, consume bool) (string, error) {
	if !g.IsClientToken(token) {
		return token, nil
	}
	if !g.Configured() {
		return "", ErrUnavailable
	}
	if !CountsAsPlay(mediaType) {
		return g.ServerKey, nil
	}
	if g.Store == nil {
		g.Store = NewStore("", DefaultPlayLimit)
	}
	if consume {
		if err := g.Store.Consume(userID); err != nil {
			return "", err
		}
		return g.ServerKey, nil
	}
	if g.Store.Remaining(userID) <= 0 {
		return "", ErrLimitReached
	}
	return g.ServerKey, nil
}
