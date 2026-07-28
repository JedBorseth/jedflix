package letterboxd

import (
	"encoding/xml"
	"html"
	"io"
	"regexp"
	"strconv"
	"strings"
)

type rssFeed struct {
	Channel rssChannel `xml:"channel"`
}

type rssChannel struct {
	Title string    `xml:"title"`
	Link  string    `xml:"link"`
	Items []rssItem `xml:"item"`
}

type rssItem struct {
	Title        string `xml:"title"`
	Link         string `xml:"link"`
	Description  string `xml:"description"`
	WatchedDate  string `xml:"https://letterboxd.com watchedDate"`
	FilmTitle    string `xml:"https://letterboxd.com filmTitle"`
	FilmYear     string `xml:"https://letterboxd.com filmYear"`
	MemberRating string `xml:"https://letterboxd.com memberRating"`
	TmdbMovieID  string `xml:"https://themoviedb.org movieId"`
	TmdbTVID     string `xml:"https://themoviedb.org tvId"`
}

var (
	slugFromLinkRe = regexp.MustCompile(`/film/([^/]+)/`)
	posterFromDesc = regexp.MustCompile(`(?i)<img[^>]+src=["']([^"']+)["']`)
	usernameRe     = regexp.MustCompile(`^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,29}$`)
)

func NormalizeUsername(username string) (string, error) {
	normalized := strings.TrimSpace(strings.ToLower(username))
	if normalized == "" || !usernameRe.MatchString(normalized) {
		return "", ErrInvalidUsername
	}
	return normalized, nil
}

func ParseDiaryRSS(r io.Reader) (displayName string, films []FilmEntry, err error) {
	decoder := xml.NewDecoder(r)
	decoder.Strict = false
	var feed rssFeed
	if err := decoder.Decode(&feed); err != nil {
		return "", nil, err
	}

	displayName = strings.TrimSpace(strings.TrimPrefix(feed.Channel.Title, "Letterboxd - "))
	films = make([]FilmEntry, 0, len(feed.Channel.Items))
	seen := make(map[string]struct{})

	for _, item := range feed.Channel.Items {
		title := strings.TrimSpace(html.UnescapeString(item.FilmTitle))
		if title == "" {
			// List updates and non-diary items lack filmTitle — skip them.
			continue
		}

		slug := slugFromLink(item.Link)
		key := slug
		if key == "" {
			key = strings.ToLower(title) + "|" + item.FilmYear
		}
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}

		entry := FilmEntry{
			Slug:        slug,
			Title:       title,
			WatchedDate: strings.TrimSpace(item.WatchedDate),
			Link:        strings.TrimSpace(item.Link),
			PosterURL:   posterURLFromDescription(item.Description),
		}
		if year, ok := parseInt(item.FilmYear); ok {
			entry.Year = &year
		}
		if tmdbID, ok := parseInt(firstNonEmpty(item.TmdbMovieID, item.TmdbTVID)); ok {
			entry.TmdbID = &tmdbID
		}
		if rating, ok := parseFloat(item.MemberRating); ok {
			entry.Rating = &rating
		}
		films = append(films, entry)
	}

	return displayName, films, nil
}

func slugFromLink(link string) string {
	match := slugFromLinkRe.FindStringSubmatch(link)
	if len(match) < 2 {
		return ""
	}
	return match[1]
}

func posterURLFromDescription(description string) string {
	match := posterFromDesc.FindStringSubmatch(description)
	if len(match) < 2 {
		return ""
	}
	return html.UnescapeString(match[1])
}

func parseInt(value string) (int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	n, err := strconv.Atoi(value)
	if err != nil {
		return 0, false
	}
	return n, true
}

func parseFloat(value string) (float64, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, false
	}
	n, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
