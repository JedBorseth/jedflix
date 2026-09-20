package youtube

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestAcquireWaitsInsteadOfRejecting(t *testing.T) {
	r := NewResolverWithLimit(1)
	ctx, cancel := context.WithTimeout(context.Background(), 40*time.Millisecond)
	defer cancel()

	if err := r.acquire(ctx); err != nil {
		t.Fatalf("first acquire: %v", err)
	}

	err := r.acquire(ctx)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("expected wait timeout, got %v", err)
	}
}

func TestReleaseFreesSlot(t *testing.T) {
	r := NewResolverWithLimit(1)
	ctx := context.Background()
	if err := r.acquire(ctx); err != nil {
		t.Fatal(err)
	}
	r.release()
	if err := r.acquire(ctx); err != nil {
		t.Fatalf("acquire after release: %v", err)
	}
}

func TestAcquireReturnsWhenContextCanceled(t *testing.T) {
	r := NewResolverWithLimit(1)
	if err := r.acquire(context.Background()); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	errc := make(chan error, 1)
	go func() {
		errc <- r.acquire(ctx)
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
		acquireDone <- r.acquire(context.Background())
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
		r.release()
	case <-time.After(time.Second):
		t.Fatal("concurrency slot was not released")
	}
}

func TestCancelLastWaiterUnblocksAcquireWithoutTakingSlot(t *testing.T) {
	r := NewResolverWithLimit(1)
	if err := r.acquire(context.Background()); err != nil {
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
	r.release()
	ctx, cancel = context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	if err := r.acquire(ctx); err != nil {
		t.Fatalf("slot leaked after cancelled waiter: %v", err)
	}
}
