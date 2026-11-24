package resolver

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/bookchapters"
	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/realdebrid"
)

const testHash = "95b125d9a7df53aab524999e245265078cbc00de"

// fakeRD is a minimal Real Debrid API holding torrents in memory.
type fakeRD struct {
	mu       sync.Mutex
	torrents map[string]*realdebrid.TorrentInfo
	nextID   int
	// files every newly added magnet resolves to.
	newFiles []realdebrid.TorrentFile
	added    []string
	deleted  []string
	// failAdd creates the torrent but answers the add with a 503.
	failAdd bool
}

func (f *fakeRD) handler(t *testing.T) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		path := r.URL.Path
		switch {
		case r.Method == http.MethodGet && path == "/torrents":
			rows := []realdebrid.TorrentSummary{}
			for id, info := range f.torrents {
				rows = append(rows, realdebrid.TorrentSummary{ID: id, Hash: info.Hash, Status: info.Status})
			}
			if len(rows) == 0 {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			_ = json.NewEncoder(w).Encode(rows)
		case r.Method == http.MethodPost && path == "/torrents/addMagnet":
			_ = r.ParseForm()
			f.nextID++
			id := "new" + strconv.Itoa(f.nextID)
			files := append([]realdebrid.TorrentFile(nil), f.newFiles...)
			f.torrents[id] = &realdebrid.TorrentInfo{
				ID: id, Hash: testHash, Status: "waiting_files_selection", Files: files,
			}
			f.added = append(f.added, id)
			if f.failAdd {
				http.Error(w, `{"error":"service_unavailable"}`, http.StatusServiceUnavailable)
				return
			}
			_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
		case r.Method == http.MethodPost && strings.HasPrefix(path, "/torrents/selectFiles/"):
			_ = r.ParseForm()
			info := f.torrents[strings.TrimPrefix(path, "/torrents/selectFiles/")]
			want := map[string]bool{}
			for _, id := range strings.Split(r.Form.Get("files"), ",") {
				want[id] = true
			}
			info.Links = nil
			for i := range info.Files {
				info.Files[i].Selected = 0
				if want[strconv.Itoa(info.Files[i].ID)] {
					info.Files[i].Selected = 1
					info.Links = append(info.Links, "https://rd.example/link/"+strconv.Itoa(info.Files[i].ID))
				}
			}
			info.Status = "downloaded"
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodGet && strings.HasPrefix(path, "/torrents/info/"):
			info, ok := f.torrents[strings.TrimPrefix(path, "/torrents/info/")]
			if !ok {
				http.NotFound(w, r)
				return
			}
			_ = json.NewEncoder(w).Encode(info)
		case r.Method == http.MethodDelete && strings.HasPrefix(path, "/torrents/delete/"):
			id := strings.TrimPrefix(path, "/torrents/delete/")
			delete(f.torrents, id)
			f.deleted = append(f.deleted, id)
			w.WriteHeader(http.StatusNoContent)
		case r.Method == http.MethodPost && path == "/unrestrict/link":
			_ = r.ParseForm()
			link := r.Form.Get("link")
			id := link[strings.LastIndex(link, "/")+1:]
			_ = json.NewEncoder(w).Encode(realdebrid.UnrestrictResponse{
				Download: "https://dl.example/" + id + ".m4b",
				Filename: "file" + id + ".m4b",
				Filesize: 100,
			})
		default:
			t.Errorf("unexpected Real Debrid call %s %s", r.Method, path)
			http.Error(w, "unexpected", http.StatusTeapot)
		}
	})
}

type stubChapters struct {
	result  *bookchapters.Result
	lookups []bookchapters.Lookup
	mu      sync.Mutex
}

func (s *stubChapters) Find(_ context.Context, lookup bookchapters.Lookup) *bookchapters.Result {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.lookups = append(s.lookups, lookup)
	return s.result
}

func newTestService(t *testing.T, rd *fakeRD) (*Service, *stubChapters) {
	t.Helper()
	if rd.torrents == nil {
		rd.torrents = map[string]*realdebrid.TorrentInfo{}
	}
	server := httptest.NewServer(rd.handler(t))
	t.Cleanup(server.Close)
	chapters := &stubChapters{}
	service := NewService(config.Config{}, nil, nil)
	service.chapters = chapters
	service.newRD = func(token string) *realdebrid.Client {
		return realdebrid.NewClientWithBase(server.URL, token, server.Client())
	}
	return service, chapters
}

func bookRequest() ResolveRequest {
	return ResolveRequest{
		Type:            "audiobook",
		Magnet:          "magnet:?xt=urn:btih:" + testHash,
		MediaTitle:      "Harry Potter and the Philosopher's Stone",
		Author:          "J.K. Rowling",
		RealDebridToken: "token",
	}
}

func singleBookFile() []realdebrid.TorrentFile {
	return []realdebrid.TorrentFile{
		{ID: 1, Path: "/HP1/cover.jpg", Bytes: 10},
		{ID: 2, Path: "/HP1/Harry Potter 1.m4b", Bytes: 500},
	}
}

func TestResolveBookKeepsAddedTorrentAfterSuccess(t *testing.T) {
	rd := &fakeRD{newFiles: singleBookFile()}
	service, _ := newTestService(t, rd)

	result, err := service.Resolve(context.Background(), bookRequest())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(result.Files) != 1 || result.Files[0].FileID != 2 {
		t.Fatalf("files = %+v", result.Files)
	}
	if len(rd.added) != 1 {
		t.Fatalf("added = %v", rd.added)
	}
	if len(rd.deleted) != 0 {
		t.Fatalf("a played torrent was deleted from the account: %v", rd.deleted)
	}
}

func TestResolveBookReusesTorrentAlreadyInAccount(t *testing.T) {
	files := singleBookFile()
	files[0].Selected = 1 // selected "all" earlier: cover plus audio
	files[1].Selected = 1
	rd := &fakeRD{
		torrents: map[string]*realdebrid.TorrentInfo{
			"owned": {
				ID: "owned", Hash: testHash, Status: "downloaded", Files: files,
				Links: []string{"https://rd.example/link/1", "https://rd.example/link/2"},
			},
		},
	}
	service, _ := newTestService(t, rd)

	result, err := service.Resolve(context.Background(), bookRequest())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(rd.added) != 0 {
		t.Fatalf("re-added a torrent the account already has: %v", rd.added)
	}
	if len(rd.deleted) != 0 {
		t.Fatalf("deleted = %v", rd.deleted)
	}
	// The audio's link is the second selected file's, not the cover's.
	if got := result.Files[0].URL; got != "https://dl.example/2.m4b" {
		t.Fatalf("url = %q", got)
	}
}

func TestResolveVideoAddsCopyWhenOwnedTorrentSelectedOtherEpisode(t *testing.T) {
	files := []realdebrid.TorrentFile{
		{ID: 1, Path: "/Show/Show.S01E01.mkv", Bytes: 100, Selected: 1},
		{ID: 2, Path: "/Show/Show.S01E02.mkv", Bytes: 100},
	}
	rd := &fakeRD{
		newFiles: []realdebrid.TorrentFile{
			{ID: 1, Path: "/Show/Show.S01E01.mkv", Bytes: 100},
			{ID: 2, Path: "/Show/Show.S01E02.mkv", Bytes: 100},
		},
		torrents: map[string]*realdebrid.TorrentInfo{
			"owned": {ID: "owned", Hash: testHash, Status: "downloaded", Files: files, Links: []string{"https://rd.example/link/1"}},
		},
	}
	service, _ := newTestService(t, rd)
	season, episode := 1, 2

	result, err := service.Resolve(context.Background(), ResolveRequest{
		Type: "tv", Magnet: "magnet:?xt=urn:btih:" + testHash, Season: &season, Episode: &episode,
		RealDebridToken: "token",
	})
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	if len(rd.added) != 1 || len(rd.deleted) != 0 {
		t.Fatalf("added = %v deleted = %v", rd.added, rd.deleted)
	}
	if _, ok := rd.torrents["owned"]; !ok {
		t.Fatal("the episode already in the account was removed")
	}
	if result.Files[0].FileID != 2 {
		t.Fatalf("file = %+v", result.Files[0])
	}
}

func TestResolveBookDeletesAddedTorrentWithoutAudio(t *testing.T) {
	rd := &fakeRD{newFiles: []realdebrid.TorrentFile{{ID: 1, Path: "/x/readme.txt", Bytes: 1}}}
	service, _ := newTestService(t, rd)

	_, err := service.Resolve(context.Background(), bookRequest())
	if err == nil {
		t.Fatal("expected title_mismatch")
	}
	if len(rd.deleted) != 1 || rd.deleted[0] != rd.added[0] {
		t.Fatalf("added = %v deleted = %v", rd.added, rd.deleted)
	}
}

func TestResolveBookAttachesChaptersForSingleFile(t *testing.T) {
	rd := &fakeRD{newFiles: singleBookFile()}
	service, chapters := newTestService(t, rd)
	chapters.result = &bookchapters.Result{
		Source: bookchapters.SourceEmbedded,
		Chapters: []bookchapters.Chapter{
			{Title: "Opening Credits", StartSec: 0, EndSec: 63},
			{Title: "Chapter 1 - The Boy Who Lived", StartSec: 63, EndSec: 1970},
		},
	}

	result, err := service.Resolve(context.Background(), bookRequest())
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	file := result.Files[0]
	if len(file.Chapters) != 2 || file.ChapterSource != bookchapters.SourceEmbedded {
		t.Fatalf("chapters = %+v (%s)", file.Chapters, file.ChapterSource)
	}
	lookup := chapters.lookups[0]
	if lookup.Key != testHash+":2" || !lookup.AllowCatalog || lookup.Author != "J.K. Rowling" {
		t.Fatalf("lookup = %+v", lookup)
	}
}

func TestBookSourcesMarkOwnedCachedAndSkipProbe(t *testing.T) {
	rd := &fakeRD{
		torrents: map[string]*realdebrid.TorrentInfo{
			"owned": {ID: "owned", Hash: testHash, Status: "downloaded"},
		},
	}
	service, _ := newTestService(t, rd)
	sources := []Source{{ID: "abb_0", Magnet: "magnet:?xt=urn:btih:" + testHash, InfoHash: testHash}}

	service.enrichBookSeedersFromRD(context.Background(), sources, 3, "token")

	if !sources[0].Cached {
		t.Fatal("a source already downloaded in the account should be cached")
	}
	if len(rd.added) != 0 || len(rd.deleted) != 0 {
		t.Fatalf("probe touched an owned torrent: added = %v deleted = %v", rd.added, rd.deleted)
	}
}

func TestSeederProbeRemovesItsCopy(t *testing.T) {
	rd := &fakeRD{newFiles: singleBookFile()}
	// The probe sees magnet_conversion with seeders, like a live swarm.
	service, _ := newTestService(t, rd)
	sources := []Source{{ID: "abb_0", Magnet: "magnet:?xt=urn:btih:" + testHash, InfoHash: testHash}}

	service.enrichBookSeedersFromRD(context.Background(), sources, 3, "token")

	waitFor(t, func() bool {
		rd.mu.Lock()
		defer rd.mu.Unlock()
		return len(rd.added) == 1 && len(rd.torrents) == 0
	})
}

func waitFor(t *testing.T, done func() bool) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for !done() {
		if time.Now().After(deadline) {
			t.Fatal("condition not met in time")
		}
		time.Sleep(20 * time.Millisecond)
	}
}

func TestSeederProbeSweepsCopyWhenAddErrors(t *testing.T) {
	rd := &fakeRD{newFiles: singleBookFile(), failAdd: true}
	service, _ := newTestService(t, rd)
	sources := []Source{{ID: "abb_0", Magnet: "magnet:?xt=urn:btih:" + testHash, InfoHash: testHash}}

	service.enrichBookSeedersFromRD(context.Background(), sources, 3, "token")

	waitFor(t, func() bool {
		rd.mu.Lock()
		defer rd.mu.Unlock()
		return len(rd.added) == 1 && len(rd.torrents) == 0
	})
}
