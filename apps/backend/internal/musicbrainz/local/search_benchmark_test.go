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
	queries := []string{
		"bohemian rhapsody", "bohemian rapsody", "smells like teen spirt", "taylor swift",
		"taylr swft", "taylor swi", "kendrick humble", "kendrik lamr", "billie eilish bad guy",
		"billie eil", "fleetwod mac dreams", "fleetwood mac", "beyonse", "metalica",
		"coldpaly yellow", "drake", "the beatles", "love", "the", "queen", "adele hello",
		"ac dc back in black", "acdc", "宇多田ヒカル First Love", "sigur ros", "beyoncé",
		"hey jude", "radiohead creep",
	}
	for _, pass := range []string{"first", "warm"} {
		var latencies []time.Duration
		for _, query := range queries {
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
		}
		slices.Sort(latencies)
		t.Logf("%s p95 | %v", pass, latencies[(95*len(latencies)+99)/100-1].Round(time.Millisecond))
	}
}
