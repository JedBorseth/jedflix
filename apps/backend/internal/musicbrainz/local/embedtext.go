package local

import (
	"fmt"
	"strings"
)

func DocumentText(entityType, name string, artists []string, album string, year *int, genres, aliases []string) string {
	var b strings.Builder
	b.Grow(192)
	switch entityType {
	case "artist":
		fmt.Fprintf(&b, "Artist: %s.", name)
	case "album":
		fmt.Fprintf(&b, "Album: %s", name)
		if len(artists) > 0 {
			fmt.Fprintf(&b, " by %s", strings.Join(artists, ", "))
		}
		if year != nil && *year > 0 {
			fmt.Fprintf(&b, " (%d)", *year)
		}
		b.WriteByte('.')
	default:
		fmt.Fprintf(&b, "Track: %s", name)
		if len(artists) > 0 {
			fmt.Fprintf(&b, " by %s", strings.Join(artists, ", "))
		}
		if album != "" {
			fmt.Fprintf(&b, ". Album: %s", album)
		}
		if year != nil && *year > 0 {
			fmt.Fprintf(&b, " (%d)", *year)
		}
		b.WriteByte('.')
	}
	if len(aliases) > 0 {
		fmt.Fprintf(&b, " Also known as: %s.", strings.Join(aliases, ", "))
	}
	if len(genres) > 0 {
		fmt.Fprintf(&b, " Genres: %s.", strings.Join(genres, ", "))
	}
	return strings.TrimSpace(b.String())
}
