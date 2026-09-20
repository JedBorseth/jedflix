package youtube

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestBuildSearchQuery(t *testing.T) {
	got := buildSearchQuery(Request{Artist: "Radiohead", Title: "Karma Police", Album: "OK Computer"})
	want := "Radiohead Karma Police official audio"
	if got != want {
		t.Fatalf("got %q want %q", got, want)
	}
}

func TestPickBestEntryPrefersOfficialAudioOverMusicVideo(t *testing.T) {
	req := Request{
		Artist:     "Radiohead",
		Title:      "Karma Police",
		Album:      "OK Computer",
		DurationMs: 260_000,
	}
	entries := []searchEntry{
		{ID: "1", Title: "Karma Police - Radiohead (Official Music Video)", Duration: 320, ViewCount: 90_000_000, Uploader: "Radiohead"},
		{ID: "2", Title: "Karma Police - Radiohead (Official Audio)", Duration: 262, ViewCount: 50_000_000, Uploader: "Radiohead"},
		{ID: "3", Title: "Karma Police cover", Duration: 250, ViewCount: 1000},
	}
	best := pickBestEntry(entries, req)
	if best == nil || best.ID != "2" {
		t.Fatalf("expected official audio id=2, got %+v", best)
	}
}

func TestPickBestEntryUsesDurationMatch(t *testing.T) {
	req := Request{Artist: "Artist", Title: "Song", DurationMs: 180_000}
	entries := []searchEntry{
		{ID: "mv", Title: "Song Official Audio", Duration: 240, ViewCount: 1_000_000},
		{ID: "ok", Title: "Song Official Audio", Duration: 181, ViewCount: 100_000},
	}
	best := pickBestEntry(entries, req)
	if best == nil || best.ID != "ok" {
		t.Fatalf("expected duration match id=ok, got %+v", best)
	}
}

func TestContentTypeFor(t *testing.T) {
	if got := contentTypeFor("m4a", "mp4a.40.2"); got != "audio/mp4" {
		t.Fatalf("m4a => %s", got)
	}
	if got := contentTypeFor("webm", "opus"); got != "audio/webm" {
		t.Fatalf("webm => %s", got)
	}
}

func TestIsBrowserSafeAudio(t *testing.T) {
	if !isBrowserSafeAudio("m4a", "mp4a.40.2") {
		t.Fatal("m4a should be safe")
	}
	if !isBrowserSafeAudio("mp3", "mp3") {
		t.Fatal("mp3 should be safe")
	}
	if isBrowserSafeAudio("webm", "opus") {
		t.Fatal("webm/opus is not Safari-safe")
	}
	if isBrowserSafeAudio("ogg", "vorbis") {
		t.Fatal("ogg/vorbis is not Safari-safe")
	}
}

func TestNormalizeText(t *testing.T) {
	got := normalizeText("  Karma-Police (Official Audio)! ")
	if got != "karma police official audio" {
		t.Fatalf("got %q", got)
	}
}

func TestIsLikelyLiveOrNonMusic(t *testing.T) {
	req := Request{DurationMs: 200_000}
	if !isLikelyLiveOrNonMusic(&searchEntry{Title: "Official Trailer", Duration: 120}, req) {
		t.Fatal("expected trailer filtered")
	}
	if !isLikelyLiveOrNonMusic(&searchEntry{Title: "Song Official Music Video", Duration: 280}, req) {
		t.Fatal("expected long music video filtered when duration known")
	}
	if isLikelyLiveOrNonMusic(&searchEntry{Title: "Song Name Official Audio", Duration: 210}, req) {
		t.Fatal("normal song should pass")
	}
	if !isLikelyLiveOrNonMusic(&searchEntry{Title: "Bone Machine (Live at Brixton)", Duration: 210}, req) {
		t.Fatal("expected concert upload filtered")
	}
	if isLikelyLiveOrNonMusic(&searchEntry{Title: "Live and Let Die Official Audio", Duration: 190}, Request{
		Title:      "Live and Let Die",
		DurationMs: 190_000,
	}) {
		t.Fatal("studio song with Live in the title should pass")
	}
}

func TestSanitizeResolveRequestDropsLiveAlbumHints(t *testing.T) {
	got := sanitizeResolveRequest(Request{
		Artist:     "Pixies",
		Title:      "Bone Machine",
		Album:      "2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
		DurationMs: 340_000,
	})
	if got.Album != "" || got.DurationMs != 0 {
		t.Fatalf("expected live album/duration stripped, got %+v", got)
	}

	kept := sanitizeResolveRequest(Request{
		Artist:     "Pixies",
		Title:      "Bone Machine",
		Album:      "Doolittle",
		DurationMs: 183_000,
	})
	if kept.Album != "Doolittle" || kept.DurationMs != 183_000 {
		t.Fatalf("expected studio album kept, got %+v", kept)
	}
}

func TestPickBestEntryPrefersStudioOverLiveConcert(t *testing.T) {
	req := Request{
		Artist:     "Pixies",
		Title:      "Bone Machine",
		Album:      "2009-10-06/09: Doolittle Live: Brixton Academy, London, UK",
		DurationMs: 340_000,
	}
	req = sanitizeResolveRequest(req)
	entries := []searchEntry{
		{ID: "live", Title: "Pixies - Bone Machine (Live at Brixton Academy)", Duration: 340, ViewCount: 80_000},
		{ID: "studio", Title: "Pixies - Bone Machine (Official Audio)", Duration: 183, ViewCount: 5_000_000, Uploader: "Pixies - Topic"},
	}
	best := pickBestEntry(entries, req)
	if best == nil || best.ID != "studio" {
		t.Fatalf("expected studio official audio, got %+v", best)
	}
}

func TestPickBestEntryDoesNotFallBackToLiveConcert(t *testing.T) {
	req := Request{Artist: "The White Stripes", Title: "Seven Nation Army"}
	entries := []searchEntry{
		{ID: "live", Title: "Seven Nation Army - Live at the Masonic Temple", Duration: 488, ViewCount: 1_000_000},
	}
	best := pickBestEntry(entries, req)
	if best != nil {
		t.Fatalf("expected no live fallback, got %+v", best)
	}
}

func TestResolveSharesInflightJobForSameKey(t *testing.T) {
	r := NewResolverWithLimit(1)
	var calls atomic.Int32
	started := make(chan struct{})
	finish := make(chan struct{})
	result := StreamInfo{URL: "https://example.test/a.m4a", Title: "Song", VideoID: "abc"}
	r.resolveUncachedFn = func(ctx context.Context, req Request) (*StreamInfo, error) {
		if calls.Add(1) == 1 {
			close(started)
		}
		select {
		case <-finish:
			info := result
			return &info, nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	req := Request{Artist: "Artist", Title: "Song"}
	var firstErr, secondErr error
	var first, second *StreamInfo
	var wg sync.WaitGroup
	wg.Add(1)
	go func() {
		defer wg.Done()
		first, firstErr = r.Resolve(context.Background(), req)
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("job did not start")
	}

	wg.Add(1)
	secondDone := make(chan struct{})
	go func() {
		defer wg.Done()
		defer close(secondDone)
		second, secondErr = r.Resolve(context.Background(), req)
	}()

	select {
	case <-secondDone:
		t.Fatal("second waiter returned before the shared job finished")
	case <-time.After(30 * time.Millisecond):
	}

	close(finish)
	wg.Wait()

	if firstErr != nil || secondErr != nil {
		t.Fatalf("resolve errors: %v %v", firstErr, secondErr)
	}
	if calls.Load() != 1 {
		t.Fatalf("expected 1 shared job, got %d", calls.Load())
	}
	if first == nil || second == nil || first.URL != result.URL || second.URL != result.URL {
		t.Fatalf("unexpected results: %+v %+v", first, second)
	}
}

func TestResolveKeepsJobWhenOtherWaiterRemains(t *testing.T) {
	r := NewResolverWithLimit(1)
	var jobCancelled atomic.Bool
	started := make(chan struct{})
	finish := make(chan struct{})
	result := StreamInfo{URL: "https://example.test/b.m4a", Title: "Song"}
	r.resolveUncachedFn = func(ctx context.Context, req Request) (*StreamInfo, error) {
		close(started)
		select {
		case <-finish:
			info := result
			return &info, nil
		case <-ctx.Done():
			jobCancelled.Store(true)
			return nil, ctx.Err()
		}
	}

	req := Request{Artist: "Artist", Title: "Song"}
	headCtx, cancelHead := context.WithCancel(context.Background())
	headErr := make(chan error, 1)
	go func() {
		_, err := r.Resolve(headCtx, req)
		headErr <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("job did not start")
	}

	var got *StreamInfo
	getErr := make(chan error, 1)
	getDone := make(chan struct{})
	go func() {
		defer close(getDone)
		info, err := r.Resolve(context.Background(), req)
		got = info
		getErr <- err
	}()

	select {
	case <-getDone:
		t.Fatal("remaining waiter returned before the shared job finished")
	case <-time.After(30 * time.Millisecond):
	}

	cancelHead()
	select {
	case err := <-headErr:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("cancelled HEAD waiter: %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled waiter did not return")
	}

	select {
	case <-getDone:
		t.Fatal("GET waiter returned after HEAD cancel; shared job should continue")
	case <-time.After(30 * time.Millisecond):
	}
	if jobCancelled.Load() {
		t.Fatal("shared job was cancelled while a GET waiter remained")
	}

	close(finish)
	if err := <-getErr; err != nil {
		t.Fatalf("remaining waiter: %v", err)
	}
	if got == nil || got.URL != result.URL {
		t.Fatalf("remaining waiter result: %+v", got)
	}
}

func TestResolveCacheHitDoesNotStartJobOrTakeSlot(t *testing.T) {
	r := NewResolverWithLimit(1)
	var calls atomic.Int32
	result := StreamInfo{URL: "https://example.test/cached.m4a", Title: "Song"}
	r.resolveUncachedFn = func(ctx context.Context, req Request) (*StreamInfo, error) {
		calls.Add(1)
		info := result
		return &info, nil
	}

	req := Request{Artist: "Artist", Title: "Song"}
	first, err := r.Resolve(context.Background(), req)
	if err != nil {
		t.Fatalf("first resolve: %v", err)
	}

	if err := r.acquire(context.Background()); err != nil {
		t.Fatalf("hold slot: %v", err)
	}
	defer r.release()

	done := make(chan struct{})
	var second *StreamInfo
	var secondErr error
	go func() {
		defer close(done)
		second, secondErr = r.Resolve(context.Background(), req)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("cache hit blocked on a concurrency slot")
	}
	if secondErr != nil {
		t.Fatalf("cache hit: %v", secondErr)
	}
	if calls.Load() != 1 {
		t.Fatalf("cache hit started another job: %d", calls.Load())
	}
	if first.URL != result.URL || second.URL != result.URL {
		t.Fatalf("cached results: %+v %+v", first, second)
	}
}
