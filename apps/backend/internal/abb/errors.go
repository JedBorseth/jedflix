package abb

import "fmt"

// FetchError separates upstream HTTP failures from failures to reach ABB at all.
// Upstream response bodies and request URLs must not become user-facing errors.
type FetchError struct {
	StatusCode int
	Cause      error
}

func (e *FetchError) Error() string {
	if e.StatusCode != 0 {
		return fmt.Sprintf("AudiobookBay request failed (HTTP %d)", e.StatusCode)
	}
	return "AudiobookBay connection failed"
}

func (e *FetchError) Unwrap() error { return e.Cause }
