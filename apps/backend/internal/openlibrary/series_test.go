package openlibrary

import (
	"testing"
	"time"
)

func TestPickSeriesRotatesByUTCDay(t *testing.T) {
	series := []SeriesConfig{
		{Title: "Harry Potter Collection", Key: "harry_potter"},
		{Title: "A Court of Thorns and Roses", Key: "acotar"},
	}
	day1 := time.Date(2026, 9, 10, 8, 0, 0, 0, time.UTC)
	sameDay := time.Date(2026, 9, 10, 23, 59, 0, 0, time.UTC)
	nextDay := time.Date(2026, 9, 11, 0, 0, 0, 0, time.UTC)

	first, ok := pickSeries(day1, series)
	if !ok {
		t.Fatal("expected a series")
	}
	same, _ := pickSeries(sameDay, series)
	if same.Key != first.Key {
		t.Fatalf("series changed within the UTC day: %s -> %s", first.Key, same.Key)
	}
	next, _ := pickSeries(nextDay, series)
	if next.Key == first.Key {
		t.Fatalf("expected a different series on the next UTC day, still %s", first.Key)
	}
}

func TestPickSeriesEmpty(t *testing.T) {
	if _, ok := pickSeries(time.Now(), nil); ok {
		t.Fatal("empty pool should not pick a series")
	}
}

func TestOrderBooksByIDs(t *testing.T) {
	books := []Book{
		{ID: "OL2W", Title: "Second"},
		{ID: "OL1W", Title: "First"},
		{ID: "OL3W", Title: "Third"},
	}
	ordered := orderBooksByIDs(books, []string{"OL1W", "OL2W", "OL9W"})
	if len(ordered) != 2 {
		t.Fatalf("ordered = %+v", ordered)
	}
	if ordered[0].Title != "First" || ordered[1].Title != "Second" {
		t.Fatalf("ordered = %+v", ordered)
	}
}
