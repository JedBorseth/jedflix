package bookchapters

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

const hpDuration = 31285.0 // 8h41m25s

func TestParseFFProbeReadsChaptersAndDuration(t *testing.T) {
	probe, err := parseFFProbe([]byte(`{
		"chapters": [
			{"id": 0, "start_time": "0.000000", "end_time": "63.000000", "tags": {"title": "Opening Credits"}},
			{"id": 1, "start_time": "63.000000", "end_time": "1970.500000", "tags": {"title": "Chapter 1 - The Boy Who Lived"}}
		],
		"format": {"duration": "31285.120000"}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	if probe.DurationSec != 31285.12 || len(probe.Chapters) != 2 || probe.Chapters[1].Title != "Chapter 1 - The Boy Who Lived" {
		t.Fatalf("probe = %+v", probe)
	}
}

func TestNormalizeFillsEndsAndNamesUntitled(t *testing.T) {
	got := normalize([]Chapter{
		{Title: "", StartSec: 600},
		{Title: "Intro", StartSec: 0},
		{Title: "Sliver", StartSec: 599.7, EndSec: 599.9},
	}, 1200)
	if len(got) != 2 {
		t.Fatalf("got %+v", got)
	}
	if got[0].Title != "Intro" || got[0].EndSec != 599.7 {
		t.Fatalf("first = %+v", got[0])
	}
	if got[1].Title != "Chapter 2" || got[1].StartSec != 600 || got[1].EndSec != 1200 {
		t.Fatalf("second = %+v", got[1])
	}
}

func TestFindPrefersEmbeddedAndCaches(t *testing.T) {
	var probes int32
	finder := NewFinder(Options{Probe: func(context.Context, string) (*Probe, error) {
		atomic.AddInt32(&probes, 1)
		return &Probe{DurationSec: 120, Chapters: []Chapter{{Title: "A", StartSec: 0}, {Title: "B", StartSec: 60}}}, nil
	}})
	lookup := Lookup{Key: "hash:1", URL: "https://dl.example/a.m4b", AllowCatalog: true}
	for i := 0; i < 2; i++ {
		result := finder.Find(context.Background(), lookup)
		if result == nil || result.Source != SourceEmbedded || len(result.Chapters) != 2 {
			t.Fatalf("result = %+v", result)
		}
	}
	if probes != 1 {
		t.Fatalf("probed %d times; want cached", probes)
	}
}

func TestFindDoesNotCacheProbeFailures(t *testing.T) {
	var probes int32
	finder := NewFinder(Options{Probe: func(context.Context, string) (*Probe, error) {
		atomic.AddInt32(&probes, 1)
		return nil, errors.New("connection reset")
	}})
	lookup := Lookup{Key: "hash:1", URL: "https://dl.example/a.m4b"}
	finder.Find(context.Background(), lookup)
	finder.Find(context.Background(), lookup)
	if probes != 2 {
		t.Fatalf("probed %d times; a transient failure must not be cached", probes)
	}
}

func catalogServer(t *testing.T, runtimeMin int, audnexRuntimeMs float64) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/catalog/products":
			if !strings.Contains(r.URL.Query().Get("keywords"), "Philosopher") {
				t.Errorf("keywords = %q", r.URL.Query().Get("keywords"))
			}
			_, _ = w.Write([]byte(`{"products":[
				{"asin":"ABRIDGED","runtime_length_min":180},
				{"asin":"B0F14RPXHR","runtime_length_min":` + itoa(runtimeMin) + `}
			]}`))
		case r.URL.Path == "/books/B0F14RPXHR/chapters":
			_, _ = w.Write([]byte(`{"runtimeLengthMs":` + ftoa(audnexRuntimeMs) + `,"chapters":[
				{"title":"Opening Credits","startOffsetMs":0,"lengthMs":63000},
				{"title":"Chapter One - The Boy Who Lived","startOffsetMs":63000,"lengthMs":1907000}
			]}`))
		default:
			http.NotFound(w, r)
		}
	}))
}

func noChapterProbe(context.Context, string) (*Probe, error) {
	return &Probe{DurationSec: hpDuration}, nil
}

func TestFindFallsBackToAudibleWhenRuntimeMatches(t *testing.T) {
	server := catalogServer(t, 521, 31290000)
	defer server.Close()
	finder := NewFinder(Options{Probe: noChapterProbe, AudibleBase: server.URL, AudnexBase: server.URL})

	result := finder.Find(context.Background(), Lookup{
		Key: "hash:2", URL: "https://dl.example/hp1.m4b",
		Title: "Harry Potter and the Philosopher's Stone", Author: "J.K. Rowling", AllowCatalog: true,
	})
	if result == nil || result.Source != SourceAudible || len(result.Chapters) != 2 {
		t.Fatalf("result = %+v", result)
	}
	if result.Chapters[1].StartSec != 63 {
		t.Fatalf("chapters = %+v", result.Chapters)
	}
}

func TestFindRejectsAudibleEditionWithDifferentRuntime(t *testing.T) {
	// Catalog says 521 min, but the detailed runtime is 20 minutes longer.
	server := catalogServer(t, 521, 32485000)
	defer server.Close()
	finder := NewFinder(Options{Probe: noChapterProbe, AudibleBase: server.URL, AudnexBase: server.URL})

	result := finder.Find(context.Background(), Lookup{
		Key: "hash:3", URL: "https://dl.example/hp1.m4b",
		Title: "Harry Potter and the Philosopher's Stone", AllowCatalog: true,
	})
	if result != nil {
		t.Fatalf("matched the wrong edition: %+v", result)
	}
}

func TestFindSkipsCatalogForMultiFileBooks(t *testing.T) {
	finder := NewFinder(Options{Probe: noChapterProbe, AudibleBase: "http://127.0.0.1:1", AudnexBase: "http://127.0.0.1:1"})
	if result := finder.Find(context.Background(), Lookup{Key: "k", URL: "https://dl.example/part1.mp3", Title: "Dune"}); result != nil {
		t.Fatalf("result = %+v", result)
	}
}

func TestFFProbeRejectsNonHTTPS(t *testing.T) {
	if _, err := FFProbe(context.Background(), "file:///etc/passwd"); err == nil {
		t.Fatal("expected an error")
	}
}

func itoa(n int) string { return strconv.Itoa(n) }

func ftoa(f float64) string { return strconv.FormatFloat(f, 'f', -1, 64) }
