package tvrdkey

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestValidCode(t *testing.T) {
	t.Parallel()
	if ValidCode("short") {
		t.Fatal("expected short code to be invalid")
	}
	if !ValidCode("abcdefghijklmnopqrst") {
		t.Fatal("expected 20-char alphanumeric code to be valid")
	}
	if ValidCode("abcdefghijklmnop/") {
		t.Fatal("expected slash in code to be invalid")
	}
}

func TestOpenSubmitWaitConsumesOnce(t *testing.T) {
	t.Parallel()
	store := NewStore(time.Minute)
	code := "abcdefghijklmnopqrstuvwxyz123456"

	if err := store.Open(code); err != nil {
		t.Fatalf("open: %v", err)
	}
	if got := store.Status(code); got != StatusPending {
		t.Fatalf("status = %s", got)
	}
	if err := store.Submit(code, "  rd-secret-key  "); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if got := store.Status(code); got != StatusSubmitted {
		t.Fatalf("status after submit = %s", got)
	}

	key, err := store.Wait(context.Background(), code)
	if err != nil {
		t.Fatalf("wait: %v", err)
	}
	if key != "rd-secret-key" {
		t.Fatalf("key = %q", key)
	}
	if got := store.Status(code); got != StatusMissing {
		t.Fatalf("status after consume = %s", got)
	}
	if _, err := store.Wait(context.Background(), code); !errors.Is(err, ErrMissing) {
		t.Fatalf("second wait err = %v", err)
	}
}

func TestWaitBlocksUntilSubmit(t *testing.T) {
	t.Parallel()
	store := NewStore(time.Minute)
	code := "wait-until-submit-ok"

	if err := store.Open(code); err != nil {
		t.Fatalf("open: %v", err)
	}

	done := make(chan string, 1)
	go func() {
		key, err := store.Wait(context.Background(), code)
		if err != nil {
			t.Errorf("wait: %v", err)
			done <- ""
			return
		}
		done <- key
	}()

	time.Sleep(30 * time.Millisecond)
	if err := store.Submit(code, "from-phone"); err != nil {
		t.Fatalf("submit: %v", err)
	}

	select {
	case key := <-done:
		if key != "from-phone" {
			t.Fatalf("key = %q", key)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for waiter")
	}
}

func TestWaitTimeoutLeavesPendingSlot(t *testing.T) {
	t.Parallel()
	store := NewStore(time.Minute)
	code := "timeout-leaves-pending"

	if err := store.Open(code); err != nil {
		t.Fatalf("open: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := store.Wait(ctx, code)
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("wait err = %v", err)
	}
	if got := store.Status(code); got != StatusPending {
		t.Fatalf("status = %s", got)
	}
}

func TestSubmitRequiresOpenSlot(t *testing.T) {
	t.Parallel()
	store := NewStore(time.Minute)
	err := store.Submit("no-such-session-yet", "key")
	if !errors.Is(err, ErrMissing) {
		t.Fatalf("err = %v", err)
	}
}

func TestSubmitRejectsSecondKey(t *testing.T) {
	t.Parallel()
	store := NewStore(time.Minute)
	code := "already-filled-slot01"
	if err := store.Open(code); err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := store.Submit(code, "first"); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if err := store.Submit(code, "second"); !errors.Is(err, ErrFilled) {
		t.Fatalf("second submit err = %v", err)
	}
}

func TestExpiredSlotIsMissing(t *testing.T) {
	t.Parallel()
	store := NewStore(15 * time.Millisecond)
	code := "expires-very-quickly1"
	if err := store.Open(code); err != nil {
		t.Fatalf("open: %v", err)
	}
	time.Sleep(30 * time.Millisecond)
	if got := store.Status(code); got != StatusMissing {
		t.Fatalf("status = %s", got)
	}
}
