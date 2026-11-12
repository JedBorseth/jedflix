package youtube

import (
	"context"
	"net/url"
	"regexp"
	"sort"
	"strings"
)

const (
	// musicSongsSearchCount is how many YouTube Music "Songs" hits to read.
	musicSongsSearchCount = 8
	// maxSongCandidates caps how many title matches we extract and verify
	// before falling back to a plain YouTube search.
	maxSongCandidates = 3
)

var (
	titleDecorationPattern = regexp.MustCompile(`\s*[\(\[][^\)\]]*[\)\]]`)
	titleFeaturePattern    = regexp.MustCompile(`(?i)\s+(feat\.?|ft\.?|featuring|with)\s.*$`)
	// Words that mark a different recording of the song. A candidate carrying one
	// is skipped unless the requested title asks for it too.
	versionMarkers = []string{
		"remix", "acoustic", "instrumental", "karaoke", "sped up", "slowed",
		"nightcore", "cover", "made famous by", "in the style of", "tribute",
		"8d audio", "reverb", "lullaby", "piano version", "orchestral",
	}
)

// songMeta is the track metadata yt-dlp reports for an extracted upload.
type songMeta struct {
	Title    string
	Track    string
	Artist   string
	Artists  []string
	Channel  string
	Uploader string
	Duration float64
}

// musicSongsSearchURL targets YouTube Music's "Songs" filter, which only lists
// label-delivered audio tracks ("Art Tracks"), never music videos.
func musicSongsSearchURL(req Request) string {
	query := strings.TrimSpace(req.Artist + " " + req.Title)
	return "https://music.youtube.com/search?q=" +
		strings.ReplaceAll(url.QueryEscape(query), "+", "%20") + "#songs"
}

// resolveFromMusicSongs picks the requested song from YouTube Music's Songs
// results and confirms the artist and length from the extracted metadata.
func (r *Resolver) resolveFromMusicSongs(ctx context.Context, req Request) (*StreamInfo, error) {
	entries, err := r.flatSearch(ctx, musicSongsSearchURL(req), musicSongsSearchCount)
	if err != nil {
		return nil, err
	}
	candidates := pickSongCandidates(entries, req)
	if len(candidates) == 0 {
		return nil, ErrNotFound
	}

	lastErr := ErrNotFound
	for i := range candidates {
		info, meta, err := r.extractStream(ctx, &candidates[i])
		if err != nil {
			if ctxErr := ctx.Err(); ctxErr != nil {
				return nil, ctxErr
			}
			lastErr = err
			continue
		}
		if !songMatchesRequest(meta, req) {
			continue
		}
		return info, nil
	}
	return nil, lastErr
}

// pickSongCandidates orders Songs hits by how closely the title matches,
// keeping YouTube Music's own ranking within each tier.
func pickSongCandidates(entries []searchEntry, req Request) []searchEntry {
	type ranked struct {
		entry searchEntry
		tier  int
	}
	matches := make([]ranked, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for i := range entries {
		entry := entries[i]
		if entry.ID == "" || !isLikelyVideoID(entry.ID) {
			continue
		}
		if _, dup := seen[entry.ID]; dup {
			continue
		}
		tier := songTitleTier(entry.Title, req.Title)
		if tier < 0 {
			continue
		}
		if hasUnrequestedVersionMarker(entry.Title, req.Title) || isUnwantedLiveTitle(&entry, req) {
			continue
		}
		seen[entry.ID] = struct{}{}
		matches = append(matches, ranked{entry: entry, tier: tier})
	}
	sort.SliceStable(matches, func(a, b int) bool { return matches[a].tier < matches[b].tier })

	out := make([]searchEntry, 0, maxSongCandidates)
	for _, match := range matches {
		if len(out) == maxSongCandidates {
			break
		}
		out = append(out, match.entry)
	}
	return out
}

// songTitleTier returns 0 for an exact title match, 1 when only decorations
// such as "(Remastered)" or "feat. X" differ, 2 when one base title contains
// the other, and -1 for a different song.
func songTitleTier(candidate, want string) int {
	got := normalizeText(candidate)
	wanted := normalizeText(want)
	if got == "" || wanted == "" {
		return -1
	}
	if got == wanted {
		return 0
	}
	gotBase := baseSongTitle(candidate)
	wantBase := baseSongTitle(want)
	if gotBase == "" || wantBase == "" {
		return -1
	}
	if gotBase == wantBase {
		return 1
	}
	if len(gotBase) >= 3 && len(wantBase) >= 3 &&
		(strings.Contains(gotBase, wantBase) || strings.Contains(wantBase, gotBase)) {
		return 2
	}
	return -1
}

// baseSongTitle drops bracketed notes, featured artists, and " - Remastered"
// style suffixes so catalog and YouTube Music titles compare on the song name.
func baseSongTitle(title string) string {
	base := titleDecorationPattern.ReplaceAllString(title, "")
	for _, sep := range []string{" - ", " – ", " — "} {
		if idx := strings.Index(base, sep); idx > 0 {
			base = base[:idx]
		}
	}
	base = titleFeaturePattern.ReplaceAllString(base, "")
	return normalizeText(base)
}

func hasUnrequestedVersionMarker(candidate, want string) bool {
	got := " " + normalizeText(candidate) + " "
	wanted := " " + normalizeText(want) + " "
	for _, marker := range versionMarkers {
		needle := " " + marker + " "
		if strings.Contains(got, needle) && !strings.Contains(wanted, needle) {
			return true
		}
	}
	return false
}

// songMatchesRequest rejects covers and other recordings that share the title:
// the artist must match, and the length must be close when both are known.
func songMatchesRequest(meta songMeta, req Request) bool {
	if !songArtistMatches(meta, req.Artist) {
		return false
	}
	if req.DurationMs > 0 && meta.Duration > 0 {
		wantSec := float64(req.DurationMs) / 1000.0
		if absFloat(meta.Duration-wantSec) > maxFloat(15, wantSec*0.12) {
			return false
		}
	}
	return true
}

func songArtistMatches(meta songMeta, wantArtist string) bool {
	want := normalizeText(wantArtist)
	if want == "" {
		return true
	}
	names := append([]string{}, meta.Artists...)
	names = append(names, strings.Split(meta.Artist, ",")...)
	for _, channel := range []string{meta.Channel, meta.Uploader} {
		if topic := topicChannelArtist(channel); topic != "" {
			names = append(names, topic)
		} else {
			names = append(names, channel)
		}
	}

	all := make([]string, 0, len(names))
	for _, name := range names {
		got := normalizeText(name)
		if got == "" {
			continue
		}
		if got == want || (len(got) >= 3 && strings.Contains(want, got)) ||
			(len(want) >= 3 && strings.Contains(got, want)) {
			return true
		}
		all = append(all, got)
	}
	return tokenOverlap(strings.Join(all, " "), want) >= 0.75
}
