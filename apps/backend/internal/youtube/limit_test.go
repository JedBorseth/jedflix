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
