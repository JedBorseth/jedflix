package musicrec

import (
	"testing"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func TestPickDiverseSkipsCooldownArtist(t *testing.T) {
	tracks := []musiccatalog.TopTrack{
		{ID: "1", Name: "A", Artists: []string{"Radiohead"}},
		{ID: "2", Name: "B", Artists: []string{"Radiohead"}},
		{ID: "3", Name: "C", Artists: []string{"Portishead"}},
		{ID: "4", Name: "D", Artists: []string{"Bjork"}},
	}
	got := PickDiverse(tracks, []string{"Radiohead"}, 3)
	if len(got) != 3 {
		t.Fatalf("len=%d", len(got))
	}
	if got[0].Artists[0] == "Radiohead" {
		t.Fatal("expected cooldown artist not first")
	}
	ids := map[string]struct{}{}
	for _, track := range got {
		ids[track.ID] = struct{}{}
	}
	if _, ok := ids["3"]; !ok {
		t.Fatal("expected Portishead in the batch")
	}
}

func TestDedupeTracks(t *testing.T) {
	exclude := map[string]struct{}{"1": {}}
	got := dedupeTracks([]musiccatalog.TopTrack{
		{ID: "1", Name: "A", Artists: []string{"X"}},
		{ID: "2", Name: "Karma Police", Artists: []string{"Radiohead"}},
		{ID: "3", Name: "Karma Police", Artists: []string{"Radiohead"}},
	}, exclude)
	if len(got) != 1 || got[0].ID != "2" {
		t.Fatalf("got %+v", got)
	}
}
