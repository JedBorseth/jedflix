package search

import (
	"regexp"
	"strconv"
	"strings"
)

var sizePattern = regexp.MustCompile(`(?i)(\d+(?:\.\d+)?)\s*(gb|mb|tb)`)

func ParseSizeHintFromText(text string) (int64, bool) {
	match := sizePattern.FindStringSubmatch(text)
	if len(match) < 3 {
		return 0, false
	}
	value, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return 0, false
	}
	switch strings.ToLower(match[2]) {
	case "tb":
		return int64(value * 1024 * 1024 * 1024 * 1024), true
	case "gb":
		return int64(value * 1024 * 1024 * 1024), true
	case "mb":
		return int64(value * 1024 * 1024), true
	default:
		return 0, false
	}
}

var seedersPattern = regexp.MustCompile(`(?i)(?:👤|seeders?)\s*(\d+)`)

func ParseSeedersFromText(text string) (int, bool) {
	match := seedersPattern.FindStringSubmatch(text)
	if len(match) < 2 {
		return 0, false
	}
	n, err := strconv.Atoi(match[1])
	if err != nil {
		return 0, false
	}
	return n, true
}

var resolutionPattern = regexp.MustCompile(`(?i)(2160|1080|720|480|4k|uhd)`)

func ParseResolutionFromText(text string) int {
	lower := strings.ToLower(text)
	switch {
	case strings.Contains(lower, "2160"), strings.Contains(lower, "4k"), strings.Contains(lower, "uhd"):
		return 2160
	case strings.Contains(lower, "1080"):
		return 1080
	case strings.Contains(lower, "720"):
		return 720
	case strings.Contains(lower, "480"):
		return 480
	}
	match := resolutionPattern.FindStringSubmatch(lower)
	if len(match) < 2 {
		return 0
	}
	switch match[1] {
	case "4k", "uhd":
		return 2160
	default:
		n, _ := strconv.Atoi(match[1])
		return n
	}
}
