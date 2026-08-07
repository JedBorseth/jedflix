package abb

import (
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"sync"
	"time"
)

const maxSearchCacheEntries = 256

type cacheEntry struct {
	results   []SearchResult
	expiresAt time.Time
}

type searchCache struct {
	ttl   time.Duration
	mu    sync.Mutex
	items map[string]cacheEntry
}

func newSearchCache(ttl time.Duration) *searchCache {
	return &searchCache{
		ttl:   ttl,
		items: map[string]cacheEntry{},
	}
}

func (c *searchCache) key(query string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(query))))
	return hex.EncodeToString(sum[:])
}

func (c *searchCache) get(query string) ([]SearchResult, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	entry, ok := c.items[c.key(query)]
	if !ok || time.Now().After(entry.expiresAt) {
		if ok {
			delete(c.items, c.key(query))
		}
		return nil, false
	}
	out := make([]SearchResult, len(entry.results))
	copy(out, entry.results)
	return out, true
}

func (c *searchCache) set(query string, results []SearchResult) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.items) >= maxSearchCacheEntries {
		now := time.Now()
		for k, entry := range c.items {
			if now.After(entry.expiresAt) {
				delete(c.items, k)
			}
		}
		for k := range c.items {
			if len(c.items) < maxSearchCacheEntries/2 {
				break
			}
			delete(c.items, k)
		}
	}
	cloned := make([]SearchResult, len(results))
	copy(cloned, results)
	c.items[c.key(query)] = cacheEntry{
		results:   cloned,
		expiresAt: time.Now().Add(c.ttl),
	}
}
