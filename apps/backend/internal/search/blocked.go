package search

import (
	"regexp"
	"strings"
)

func IsRDBlockedFilename(title, pattern string) bool {
	title = strings.TrimSpace(title)
	pattern = strings.TrimSpace(pattern)
	if title == "" || pattern == "" {
		return false
	}

	re, err := regexp.Compile("(?i)" + pattern)
	if err != nil {
		return false
	}
	return re.MatchString(title)
}
