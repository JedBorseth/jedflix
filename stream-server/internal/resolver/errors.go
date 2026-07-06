package resolver

import (
	"context"
	"errors"
	"strings"

	"github.com/jedborseth/jeds-movies/stream-server/internal/realdebrid"
)

const (
	ErrorCodeInfringingFile = "infringing_file"
	ErrorCodeTimeout        = "timeout"
	ErrorCodeNoVideoFile    = "no_video_file"
	ErrorCodeSizeLimit      = "size_limit"
	ErrorCodeNoLinks        = "no_links"
)

type ResolveError struct {
	Code string
	Err  error
}

func (e *ResolveError) Error() string {
	if e.Err == nil {
		return e.Code
	}
	return e.Err.Error()
}

func (e *ResolveError) Unwrap() error {
	return e.Err
}

func newResolveError(code string, err error) error {
	if err == nil {
		err = errors.New(code)
	}
	return &ResolveError{Code: code, Err: err}
}

func classifyResolveError(err error) (string, string) {
	if err == nil {
		return "", ""
	}

	var resolveErr *ResolveError
	if errors.As(err, &resolveErr) {
		return resolveErr.Code, resolveErr.Error()
	}
	if realdebrid.IsInfringingError(err) {
		return ErrorCodeInfringingFile, err.Error()
	}
	if errors.Is(err, context.DeadlineExceeded) || strings.Contains(strings.ToLower(err.Error()), "timed out") {
		return ErrorCodeTimeout, err.Error()
	}
	return "", err.Error()
}

func terminalTorrentStatus(status string) bool {
	switch status {
	case "error", "magnet_error", "virus", "dead":
		return true
	default:
		return false
	}
}
