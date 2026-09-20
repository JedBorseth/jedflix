package youtube

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func TestAcquireWaitsInsteadOfRejecting(t *testing.T) {
	r := NewResolverWithLimit(1)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()

	if err := r.acquire(ctx, false); err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	err := r.acquire(ctx, false)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected wait timeout, got %v", err)
	}
}

func TestReleaseFreesSlot(t *testing.T) {
	r := NewResolverWithLimit(1)
	ctx := context.Background()
	if err := r.acquire(ctx, false); err != nil {
		t.Fatal(err)
	}
	r.release(false)
	if err := r.acquire(ctx, false); err != nil {
		t.Fatalf("acquire after release: %v", err)
	}
}

func TestAcquireReturnsWhenContextCanceled(t *testing.T) {
	r := NewResolverWithLimit(1)
	if err := r.acquire(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() {
		errc <- r.acquire(ctx, false)
	}()

	select {
	case err := <-errc:
		t.Fatalf("acquire should wait until cancel, got %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	cancel()
	select {
	case err := <-errc:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected canceled, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("acquire did not return after cancel")
	}
}

func TestCancelLastWaiterStopsJobAndReleasesSlot(t *testing.T) {
	r := NewResolverWithLimit(1)
	started := make(chan struct{})
	jobDone := make(chan struct{})
	r.resolveUncachedFn = func(ctx context.Context, req Request) (*StreamInfo, error) {
		close(started)
		<-ctx.Done()
		close(jobDone)
		return nil, ctx.Err()
	}

	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() {
		_, err := r.Resolve(ctx, Request{Artist: "Artist", Title: "Song"})
		errc <- err
	}()

	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("job did not start")
	}

	acquireDone := make(chan error, 1)
	go func() {
		acquireDone <- r.acquire(context.Background(), false)
	}()
	select {
	case err := <-acquireDone:
		t.Fatalf("acquire should block while the job holds the slot, got %v", err)
	case <-time.After(20 * time.Millisecond):
	}

	cancel()
	select {
	case err := <-errc:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected canceled waiter, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled waiter did not return")
	}

	select {
	case <-jobDone:
	case <-time.After(time.Second):
		t.Fatal("shared job context was not cancelled")
	}

	select {
	case err := <-acquireDone:
		if err != nil {
			t.Fatalf("blocked acquire after last waiter cancel: %v", err)
		}
		r.release(false)
	case <-time.After(time.Second):
		t.Fatal("concurrency slot was not released")
	}
}

func TestCancelLastWaiterUnblocksAcquireWithoutTakingSlot(t *testing.T) {
	r := NewResolverWithLimit(1)
	if err := r.acquire(context.Background(), false); err != nil {
		t.Fatal(err)
	}

	r.resolveUncachedFn = func(ctx context.Context, req Request) (*StreamInfo, error) {
		t.Error("yt-dlp work should not start while acquire is blocked")
		return nil, errors.New("should not run")
	}

	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() {
		_, err := r.Resolve(ctx, Request{Artist: "Artist", Title: "Song"})
		errc <- err
	}()

	time.Sleep(30 * time.Millisecond)
	cancel()
	select {
	case err := <-errc:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("expected canceled waiter, got %v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("cancelled waiter did not return")
	}

	// The abandoned job may still be inside acquire. Wait for it to observe
	// cancel and return without taking the slot we still hold.
	time.Sleep(50 * time.Millisecond)
	r.release(false)
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := r.acquire(ctx, false); err != nil {
		t.Fatalf("slot leaked after cancelled waiter: %v", err)
	}
}

func TestPrefetchCannotTakeReservedPlaybackSlot(t *testing.T) {
	r := NewResolverWithLimit(3)
	ctx := context.Background()

	if err := r.acquire(ctx, true); err != nil {
		t.Fatalf("first prefetch: %v", err)
	}
	if err := r.acquire(ctx, true); err != nil {
		t.Fatalf("second prefetch: %v", err)
	}

	blocked, cancelBlocked := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancelBlocked()
	err := r.acquire(blocked, true)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("third prefetch should wait on reserved slot, got %v", err)
	}

	if err := r.acquire(ctx, false); err != nil {
		t.Fatalf("playback should still get reserved slot: %v", err)
	}
}

func TestPlaybackCanUseAllSlots(t *testing.T) {
	r := NewResolverWithLimit(3)
	ctx := context.Background()
	for i := 0; i < 3; i++ {
		if err := r.acquire(ctx, false); err != nil {
			t.Fatalf("playback %d: %v", i, err)
		}
	}
	blocked, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()
	if err := r.acquire(blocked, false); !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("fourth playback should wait, got %v", err)
	}
}

func TestPrefetchReleaseFreesSharedSlot(t *testing.T) {
	r := NewResolverWithLimit(3)
	ctx := context.Background()
	if err := r.acquire(ctx, true); err != nil {
		t.Fatal(err)
	}
	if err := r.acquire(ctx, true); err != nil {
		t.Fatal(err)
	}
	r.release(true)

	done := make(chan error, 1)
	go func() {
		done <- r.acquire(ctx, true)
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("prefetch after release: %v", err)
		}
	case <-time.After(200 * time.Millisecond):
		t.Fatal("prefetch did not acquire after shared slot release")
	}
}

func TestCacheKeyIgnoresPrefetchFlag(t *testing.T) {
	playback := cacheKey(normalizeRequest(Request{Artist: "Pixies", Title: "Debaser"}))
	prefetch := cacheKey(normalizeRequest(Request{Artist: "Pixies", Title: "Debaser", Prefetch: true}))
	if playback != prefetch {
		t.Fatalf("prefetch must share playback cache key: %q vs %q", playback, prefetch)
	}
}

func TestPrefetchAndPlaybackAcquireDoNotDeadlock(t *testing.T) {
	r := NewResolverWithLimit(3)
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := r.acquire(ctx, true); err != nil {
				t.Errorf("prefetch: %v", err)
				return
			}
			time.Sleep(10 * time.Millisecond)
			r.release(true)
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		if err := r.acquire(ctx, false); err != nil {
			t.Errorf("playback: %v", err)
			return
		}
		r.release(false)
	}()
	wg.Wait()
}
