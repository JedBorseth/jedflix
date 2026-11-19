package local

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestMusicSearchBenchmark(t *testing.T) {
	dsn := os.Getenv("MUSIC_SEARCH_DSN")
	if dsn == "" {
		t.Skip("set MUSIC_SEARCH_DSN to benchmark a populated MusicBrainz replica")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	// Use one connection for both passes. The first pass leaves database caches
	// untouched beforehand. Only a dedicated replica can guarantee cold pages.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	store := &Store{db: db}
	queries := []struct{ query, firstHit string }{
		{"bohemian rhapsody", "track Bohemian Rhapsody — Queen"},
		{"bohemian rapsody", "track Bohemian Rhapsody — Queen"},
		{"smells like teen spirt", "track Smells Like Teen Spirit — Nirvana"},
		{"taylor swift", "artist Taylor Swift"},
		{"taylr swft", "artist Taylor Swift"},
		{"taylor swi", "artist Taylor Swift"},
		{"kendrick humble", "track HUMBLE. — Kendrick Lamar"},
		{"kendrik lamr", "artist Kendrick Lamar"},
		{"billie eilish bad guy", "track bad guy — Billie Eilish"},
		{"billie eil", "artist Billie Eilish"},
		{"fleetwod mac dreams", "track Dreams — Fleetwood Mac"},
		{"fleetwood mac", "artist Fleetwood Mac"},
		{"beyonse", "artist Beyoncé"},
		{"metalica", "artist Metallica"},
		{"coldpaly yellow", "track Yellow — Coldplay"},
		{"drake", "artist Drake"},
		{"the beatles", "artist The Beatles"},
		{"love", ""},
		{"the", ""},
		{"queen", "artist Queen"},
		{"adele hello", "track Hello — Adele"},
		{"ac dc back in black", "track Back in Black — AC/DC"},
		{"acdc", "artist AC/DC"},
		{"宇多田ヒカル First Love", "track First Love — 宇多田ヒカル"},
		{"sigur ros", "artist Sigur Rós"},
		{"beyoncé", "artist Beyoncé"},
		{"hey jude", "track Hey Jude — The Beatles"},
		{"radiohead creep", "track Creep — Radiohead"},
	}
	for _, pass := range []string{"first", "warm"} {
		var latencies []time.Duration
		for _, tt := range queries {
			query := tt.query
			start := time.Now()
			result, err := store.HybridSearch(context.Background(), query, nil, 12)
			elapsed := time.Since(start)
			latencies = append(latencies, elapsed)
			if err != nil {
				t.Errorf("%s | %s | %v | ERROR %v", pass, query, elapsed.Round(time.Millisecond), err)
				continue
			}
			if len(result.Hits) == 0 {
				t.Errorf("%s | %s | %v | no matches", pass, query, elapsed.Round(time.Millisecond))
				continue
			}
			var top []string
			for _, hit := range result.Hits[:min(len(result.Hits), 3)] {
				label := fmt.Sprintf("%s %s", hit.EntityType, hit.Name)
				if hit.EntityType != "artist" && len(hit.Artists) > 0 {
					label += " — " + strings.Join(hit.Artists, ", ")
				}
				top = append(top, label)
			}
			t.Logf("%s | %s | %v | %s", pass, query, elapsed.Round(time.Millisecond), strings.Join(top, " / "))
			if tt.firstHit != "" && !strings.EqualFold(top[0], tt.firstHit) {
				t.Errorf("query %q ranked %q first, want %q", query, top[0], tt.firstHit)
			}
		}
		slices.Sort(latencies)
		t.Logf("%s p95 | %v", pass, latencies[(95*len(latencies)+99)/100-1].Round(time.Millisecond))
	}
}
