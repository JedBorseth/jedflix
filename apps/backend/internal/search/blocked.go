package search

import (
	"regexp"
	"strings"
	"sync"
)

var blockedFilenamePatterns sync.Map

func IsRDBlockedFilename(title, pattern string) bool {
	title = strings.TrimSpace(title)
	pattern = strings.TrimSpace(pattern)
	if title == "" || pattern == "" {
		return false
	}

	cached, ok := blockedFilenamePatterns.Load(pattern)
	if !ok {
		re, _ := regexp.Compile("(?i)" + pattern)
		cached, _ = blockedFilenamePatterns.LoadOrStore(pattern, re)
	}
	re := cached.(*regexp.Regexp)
	return re != nil && re.MatchString(title)
}
