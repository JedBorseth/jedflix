package search

import (
	"regexp"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
)

type FilterOptions struct {
	MaxVideoSizeGB              float64
	MinSeeders                  int
	BlockedKeywords             []string
	RDBlockedFilenameRegex      string
	MaxResolution               int
	RequireDirectPlaybackCompat bool
}

var (
	incompatiblePattern = regexp.MustCompile(`(?i)\.mkv\b|\bmkv\b|\bremux\b|\btruehd\b|\batmos\b|\bdts(?:-?hd)?\b|\bac3\b|\beac3\b|\bdd\+\b|\bddp\b`)
	mp4Pattern          = regexp.MustCompile(`(?i)\.mp4\b|\bm4v\b|\bmp4\b`)
	h264Pattern         = regexp.MustCompile(`(?i)\bx264\b|\bh\.?264\b|\bavc\b`)
	aacPattern          = regexp.MustCompile(`(?i)\baac\b`)
	webPattern          = regexp.MustCompile(`(?i)web[-.]?dl|webrip`)
)

func FilterOptionsFromConfig(cfg config.Config) FilterOptions {
	return FilterOptions{
		MaxVideoSizeGB:         cfg.MaxVideoSizeGB,
		MinSeeders:             cfg.MinSeeders,
		BlockedKeywords:        cfg.BlockedKeywords,
		RDBlockedFilenameRegex: cfg.RDBlockedFilenameRegex,
		MaxResolution:          cfg.MaxResolution,
	}
}

func FilterReleases(releases []Release, opts FilterOptions) []Release {
	maxBytes := int64(opts.MaxVideoSizeGB * 1024 * 1024 * 1024)
	filtered := make([]Release, 0, len(releases))
	for _, release := range releases {
		if !passesFilters(release, opts, maxBytes) {
			continue
		}
		filtered = append(filtered, release)
	}
	return filtered
}

func IsDirectPlaybackIncompatible(title string) bool {
	return incompatiblePattern.MatchString(title)
}

func passesFilters(release Release, opts FilterOptions, maxBytes int64) bool {
	label := strings.ToLower(release.Title)
	for _, keyword := range opts.BlockedKeywords {
		if keyword != "" && strings.Contains(label, keyword) {
			return false
		}
	}
	if IsRDBlockedFilename(release.Title, opts.RDBlockedFilenameRegex) {
		return false
	}
	if opts.RequireDirectPlaybackCompat && IsDirectPlaybackIncompatible(release.Title) {
		return false
	}
	if release.SizeKnown && release.SizeBytes > maxBytes {
		return false
	}
	if release.SeedersKnown && release.Seeders < opts.MinSeeders {
		return false
	}
	if opts.MaxResolution > 0 && release.Resolution > opts.MaxResolution {
		return false
	}
	return true
}

func ScorePick(releases []Release, instant map[string]bool, preferInstant bool) []Release {
	type scored struct {
		release Release
		score   int
	}
	scoredReleases := make([]scored, 0, len(releases))
	for _, release := range releases {
		score := scoreRelease(release, instant, preferInstant)
		scoredReleases = append(scoredReleases, scored{release: release, score: score})
	}

	for i := 0; i < len(scoredReleases); i++ {
		for j := i + 1; j < len(scoredReleases); j++ {
			if scoredReleases[j].score > scoredReleases[i].score {
				scoredReleases[i], scoredReleases[j] = scoredReleases[j], scoredReleases[i]
			}
		}
	}

	out := make([]Release, 0, len(scoredReleases))
	for _, item := range scoredReleases {
		out = append(out, item.release)
	}
	return out
}

func scoreRelease(release Release, instant map[string]bool, preferInstant bool) int {
	score := 0
	label := release.Title

	if preferInstant && release.InfoHash != "" && instant[strings.ToLower(release.InfoHash)] {
		score += 1000
	}
	if IsDirectPlaybackIncompatible(label) {
		score -= 500
	}
	if mp4Pattern.MatchString(label) {
		score += 40
	}
	if webPattern.MatchString(label) {
		score += 30
	}
	if h264Pattern.MatchString(label) {
		score += 25
	}
	if aacPattern.MatchString(label) {
		score += 20
	}
	switch release.Resolution {
	case 2160:
		score += 15
	case 1080:
		score += 10
	case 720:
		score += 5
	}
	if release.SeedersKnown {
		score += min(release.Seeders, 100)
	}
	return score
}
