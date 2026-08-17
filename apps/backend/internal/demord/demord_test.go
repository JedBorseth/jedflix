package demord

import (
	"net/http"
	"path/filepath"
	"testing"
)

func TestStoreLocksAfterFivePlays(t *testing.T) {
	store := NewStore("", 5)
	for i := 0; i < 5; i++ {
		if err := store.Consume("user-a"); err != nil {
			t.Fatalf("play %d: %v", i+1, err)
		}
	}
	if remaining := store.Remaining("user-a"); remaining != 0 {
		t.Fatalf("remaining = %d, want 0", remaining)
	}
	if err := store.Consume("user-a"); err != ErrLimitReached {
		t.Fatalf("6th play err = %v, want ErrLimitReached", err)
	}
	if err := store.Consume("user-b"); err != nil {
		t.Fatalf("other user should still play: %v", err)
	}
}

func TestStorePersistsAcrossReload(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "plays.json")
	store := NewStore(path, 5)
	for i := 0; i < 3; i++ {
		if err := store.Consume("jed"); err != nil {
			t.Fatal(err)
		}
	}

	reloaded := NewStore(path, 5)
	if remaining := reloaded.Remaining("jed"); remaining != 2 {
		t.Fatalf("remaining after reload = %d, want 2", remaining)
	}
}

func TestGateSwapsDemoToken(t *testing.T) {
	gate := &Gate{ServerKey: "server-secret", Store: NewStore("", 5)}
	got, err := gate.Apply(ClientToken, "movie", "u1", false)
	if err != nil {
		t.Fatal(err)
	}
	if got != "server-secret" {
		t.Fatalf("token = %q", got)
	}

	passthrough, err := gate.Apply("real-user-key", "movie", "u1", true)
	if err != nil {
		t.Fatal(err)
	}
	if passthrough != "real-user-key" {
		t.Fatalf("passthrough = %q", passthrough)
	}
	if remaining := gate.Store.Remaining("u1"); remaining != 5 {
		t.Fatalf("real keys must not consume plays, remaining=%d", remaining)
	}
}

func TestGateCountsResolveNotSources(t *testing.T) {
	gate := &Gate{ServerKey: "server-secret", Store: NewStore("", 5)}
	for i := 0; i < 4; i++ {
		if _, err := gate.Apply(ClientToken, "movie", "u1", false); err != nil {
			t.Fatalf("sources %d: %v", i, err)
		}
	}
	if remaining := gate.Store.Remaining("u1"); remaining != 5 {
		t.Fatalf("listing sources consumed plays, remaining=%d", remaining)
	}

	for i := 0; i < 5; i++ {
		if _, err := gate.Apply(ClientToken, "tv", "u1", true); err != nil {
			t.Fatalf("resolve %d: %v", i+1, err)
		}
	}
	if _, err := gate.Apply(ClientToken, "audiobook", "u1", true); err != ErrLimitReached {
		t.Fatalf("6th resolve err = %v", err)
	}
	if _, err := gate.Apply(ClientToken, "movie", "u1", false); err != ErrLimitReached {
		t.Fatalf("sources after lockout err = %v", err)
	}
}

func TestGateDoesNotCountMusicOrEbook(t *testing.T) {
	gate := &Gate{ServerKey: "server-secret", Store: NewStore("", 1)}
	if _, err := gate.Apply(ClientToken, "ebook", "u1", true); err != nil {
		t.Fatal(err)
	}
	if remaining := gate.Store.Remaining("u1"); remaining != 1 {
		t.Fatalf("ebook counted as a play, remaining=%d", remaining)
	}
}

func TestGateUnavailableWithoutServerKey(t *testing.T) {
	gate := &Gate{}
	if _, err := gate.Apply(ClientToken, "movie", "u1", true); err != ErrUnavailable {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestUserIDFromHeader(t *testing.T) {
	req, err := http.NewRequest(http.MethodPost, "/api/v1/resolve", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set(UserHeader, "k57abc_user-1")
	if got := UserID(req, "1.2.3.4"); got != "k57abc_user-1" {
		t.Fatalf("got %q", got)
	}

	req.Header.Set(UserHeader, "ignore this!!!")
	if got := UserID(req, "1.2.3.4"); got != "ignorethis" {
		t.Fatalf("sanitized = %q", got)
	}
}

func TestCountsAsPlay(t *testing.T) {
	if !CountsAsPlay("movie") || !CountsAsPlay("TV") || !CountsAsPlay("audiobook") {
		t.Fatal("expected movie/tv/audiobook to count")
	}
	if CountsAsPlay("ebook") || CountsAsPlay("music") || CountsAsPlay("") {
		t.Fatal("did not expect ebook/music/empty to count")
	}
}
