package demord

import (
	"net/http"
	"os"
	"path/filepath"
	"testing"
)

const testClientKey = "demo-client-test-key"

func testGate() *Gate {
	return &Gate{
		ClientKey: testClientKey,
		ServerKey: "server-secret",
		Store:     NewStore("", 5),
	}
}

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
	gate := testGate()
	got, err := gate.Apply(testClientKey, "movie", "u1", false)
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
	gate := testGate()
	for i := 0; i < 4; i++ {
		if _, err := gate.Apply(testClientKey, "movie", "u1", false); err != nil {
			t.Fatalf("sources %d: %v", i, err)
		}
	}
	if remaining := gate.Store.Remaining("u1"); remaining != 5 {
		t.Fatalf("listing sources consumed plays, remaining=%d", remaining)
	}

	for i := 0; i < 5; i++ {
		if _, err := gate.Apply(testClientKey, "tv", "u1", true); err != nil {
			t.Fatalf("resolve %d: %v", i+1, err)
		}
	}
	if _, err := gate.Apply(testClientKey, "audiobook", "u1", true); err != ErrLimitReached {
		t.Fatalf("6th resolve err = %v", err)
	}
	if _, err := gate.Apply(testClientKey, "movie", "u1", false); err != ErrLimitReached {
		t.Fatalf("sources after lockout err = %v", err)
	}
}

func TestGateDoesNotCountMusicOrEbook(t *testing.T) {
	gate := &Gate{ClientKey: testClientKey, ServerKey: "server-secret", Store: NewStore("", 1)}
	if _, err := gate.Apply(testClientKey, "ebook", "u1", true); err != nil {
		t.Fatal(err)
	}
	if remaining := gate.Store.Remaining("u1"); remaining != 1 {
		t.Fatalf("ebook counted as a play, remaining=%d", remaining)
	}
}

func TestGateUnavailableWithoutServerKey(t *testing.T) {
	gate := &Gate{ClientKey: testClientKey}
	if _, err := gate.Apply(testClientKey, "movie", "u1", true); err != ErrUnavailable {
		t.Fatalf("err = %v, want ErrUnavailable", err)
	}
}

func TestIsClientTokenRequiresConfiguredClientKey(t *testing.T) {
	gate := &Gate{ServerKey: "server-secret"}
	if gate.IsClientToken(testClientKey) {
		t.Fatal("empty client key should not match")
	}
	gate.ClientKey = testClientKey
	if !gate.IsClientToken(testClientKey) {
		t.Fatal("expected match")
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

func TestStoreRollsBackFailedSave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plays.json")
	store := NewStore(path, 5)
	if err := os.Mkdir(path, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := store.Consume("user"); err == nil {
		t.Fatal("expected save error when the destination is a directory")
	}
	if remaining := store.Remaining("user"); remaining != 5 {
		t.Fatalf("failed save consumed a play, remaining=%d", remaining)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := store.Consume("user"); err != nil {
		t.Fatal(err)
	}
	if remaining := NewStore(path, 5).Remaining("user"); remaining != 4 {
		t.Fatalf("retry should persist one play, remaining=%d", remaining)
	}
}

func TestGateFailsClosedWhenPlayCountsAreCorrupt(t *testing.T) {
	path := filepath.Join(t.TempDir(), "plays.json")
	data := []byte(`{"plays":`)
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	gate := testGate()
	gate.Store = NewStore(path, 5)
	for _, consume := range []bool{false, true} {
		if token, err := gate.Apply(testClientKey, "movie", "user", consume); token != "" || err == nil || err == ErrLimitReached {
			t.Fatalf("consume=%v: token=%q, err=%v", consume, token, err)
		}
	}
	if remaining := gate.Store.Remaining("user"); remaining != 0 {
		t.Fatalf("store with unknown usage reported %d plays remaining", remaining)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(data) {
		t.Fatalf("store changed the corrupt file: %q, %v", got, err)
	}
}
