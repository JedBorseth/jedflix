package musicbrainz

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

func TestColdBrowseWaitsForRefreshOrCancellation(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	var startOnce, releaseOnce sync.Once
	finish := func() { releaseOnce.Do(func() { close(release) }) }
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		startOnce.Do(func() { close(started) })
		<-release
		fmt.Fprint(w, `{"release-groups":[{"id":"a74b1b7f-71a5-4011-9441-d0b5e4122711","title":"New album"}]}`)
	}))
	defer upstream.Close()
	defer finish()
	client := NewClient(config.Config{MusicBrainzAPIBaseURL: upstream.URL})
	client.genres = nil

	ctx, stop := context.WithTimeout(t.Context(), 3*time.Second)
	defer stop()
	canceledCtx, cancel := context.WithCancel(ctx)
	defer cancel()

	result := make(chan error, 1)
	go func() {
		_, err := client.Browse(canceledCtx)
		result <- err
	}()
	select {
	case <-started:
	case <-ctx.Done():
		t.Fatal("catalog refresh did not start")
	}
	cancel()
	if err := <-result; !errors.Is(err, context.Canceled) {
		t.Fatalf("cold browse returned %v, want context.Canceled", err)
	}

	finish()
	browse, err := client.Browse(ctx)
	if err != nil {
		t.Fatalf("Browse: %v", err)
	}
	if len(browse.NewReleases) != 1 || browse.NewReleases[0].Name != "New album" {
		t.Fatalf("unexpected new releases: %+v", browse.NewReleases)
	}
}
