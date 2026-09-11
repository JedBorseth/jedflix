package openlibrary

import (
	"strings"
	"time"
)

const (
	seriesRotationWindow = 24 * time.Hour
	seriesSubjectPrefix  = "series:"
)

// DefaultSeries is the rotating featured-collection pool. One series is
// selected per UTC day and held in the browse cache until the next refresh.
var DefaultSeries = []SeriesConfig{
	{
		Title: "Harry Potter Collection",
		Key:   "harry_potter",
		Works: []string{
			"OL82563W", "OL82537W", "OL82536W", "OL82560W",
			"OL82548W", "OL82565W", "OL82586W",
		},
	},
	{
		Title: "A Court of Thorns and Roses",
		Key:   "acotar",
		Works: []string{
			"OL17352669W", "OL45687843W", "OL17823218W",
			"OL19655889W", "OL21703979W",
		},
	},
	{
		Title: "The Hunger Games",
		Key:   "hunger_games",
		Works: []string{"OL5735363W", "OL5735360W", "OL14908941W", "OL20716197W"},
	},
	{
		Title: "Percy Jackson & the Olympians",
		Key:   "percy_jackson",
		Works: []string{"OL492658W", "OL492646W", "OL492647W", "OL492640W", "OL15270622W"},
	},
	{
		Title: "A Song of Ice and Fire",
		Key:   "asoiaf",
		Works: []string{"OL257943W", "OL257939W", "OL257914W", "OL257948W", "OL1955906W"},
	},
	{
		Title: "The Lord of the Rings",
		Key:   "lotr",
		Works: []string{"OL27482W", "OL27513W", "OL27479W", "OL27455W"},
	},
	{
		Title: "Throne of Glass",
		Key:   "throne_of_glass",
		Works: []string{
			"OL17546674W", "OL16607146W", "OL16809980W", "OL17367560W",
			"OL17718538W", "OL17625829W", "OL17791167W", "OL19352982W",
		},
	},
	{
		Title: "The Expanse",
		Key:   "the_expanse",
		Works: []string{
			"OL16114008W", "OL16117275W", "OL17074648W", "OL17454175W",
			"OL17755458W", "OL17793650W", "OL17857348W", "OL19800273W", "OL21704818W",
		},
	},
	{
		Title: "Dune",
		Key:   "dune",
		Works: []string{"OL893414W", "OL893461W", "OL893516W"},
	},
	{
		Title: "Twilight",
		Key:   "twilight",
		Works: []string{"OL5720023W", "OL5720027W", "OL5720025W", "OL5720022W"},
	},
	{
		Title: "His Dark Materials",
		Key:   "his_dark_materials",
		Works: []string{"OL28988W", "OL28993W", "OL28996W"},
	},
	{
		Title: "The Maze Runner",
		Key:   "maze_runner",
		Works: []string{"OL6027236W", "OL15414803W", "OL16099103W"},
	},
	{
		Title: "Red Rising",
		Key:   "red_rising",
		Works: []string{"OL17076473W", "OL19340986W", "OL19650409W"},
	},
	{
		Title: "Mistborn",
		Key:   "mistborn",
		Works: []string{"OL5738148W", "OL5738150W", "OL5738154W"},
	},
	{
		Title: "The Wheel of Time",
		Key:   "wheel_of_time",
		Works: []string{"OL7924103W", "OL7924135W", "OL7924143W"},
	},
}

func seriesSubject(key string) string {
	return seriesSubjectPrefix + key
}

func pickSeries(now time.Time, series []SeriesConfig) (SeriesConfig, bool) {
	if len(series) == 0 {
		return SeriesConfig{}, false
	}
	day := now.UTC().Unix() / int64(seriesRotationWindow.Seconds())
	if day < 0 {
		day = 0
	}
	return series[int(day)%len(series)], true
}

func previousSeriesRow(rows []SubjectRow) (SubjectRow, bool) {
	for _, row := range rows {
		if strings.HasPrefix(row.Subject, seriesSubjectPrefix) {
			return row, true
		}
	}
	return SubjectRow{}, false
}

func orderBooksByIDs(books []Book, ids []string) []Book {
	byID := make(map[string]Book, len(books))
	for _, book := range books {
		if _, exists := byID[book.ID]; !exists {
			byID[book.ID] = book
		}
	}
	ordered := make([]Book, 0, len(ids))
	for _, id := range ids {
		if book, ok := byID[id]; ok {
			ordered = append(ordered, book)
		}
	}
	return ordered
}
