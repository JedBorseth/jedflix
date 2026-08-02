package resolvejobs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/stream-server/internal/resolver"
)

func TestStoreReadyJob(t *testing.T) {
	store := NewStore(time.Minute)
	job := store.Start(5*time.Second, resolver.ResolveRequest{Type: "audiobook"}, func(
		ctx context.Context,
		req resolver.ResolveRequest,
		onProgress func(string),
	) (*resolver.StreamResult, error) {
		onProgress("working")
		return &resolver.StreamResult{URL: "https://example.com/a.m4b", Mode: "direct"}, nil
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		got, ok := store.Get(job.ID)
		if !ok {
			t.Fatal("job missing")
		}
		if got.Status == StatusReady {
			if got.Result == nil || got.Result.URL == "" {
				t.Fatalf("missing result: %#v", got)
			}
			return
		}
		if got.Status == StatusFailed {
			t.Fatalf("unexpected failure: %s", got.Error)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("timed out waiting for ready job")
}

func TestStoreFailedJob(t *testing.T) {
	store := NewStore(time.Minute)
	job := store.Start(5*time.Second, resolver.ResolveRequest{Type: "audiobook"}, func(
		ctx context.Context,
		req resolver.ResolveRequest,
		onProgress func(string),
	) (*resolver.StreamResult, error) {
		return nil, &resolver.ResolveError{Code: "abb_magnet", Message: "no magnet"}
	})

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		got, ok := store.Get(job.ID)
		if !ok {
			t.Fatal("job missing")
		}
		if got.Status == StatusFailed {
			if got.ErrorCode != "abb_magnet" {
				t.Fatalf("expected abb_magnet, got %#v", got)
			}
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("timed out waiting for failed job")
}

func TestSplitResolveErrorFallback(t *testing.T) {
	code, message := splitResolveError(errors.New("boom"))
	if code != "no_links" || message != "boom" {
		t.Fatalf("unexpected split: %s %s", code, message)
	}
}
