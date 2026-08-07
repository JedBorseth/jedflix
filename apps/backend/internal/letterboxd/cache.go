package letterboxd

import (
	"sync"
	"time"
)

const maxCacheEntries = 200

type Cache struct {
	mu      sync.RWMutex
	entries map[string]cacheEntry
	ttl     time.Duration
	now     func() time.Time
}

func NewCache(ttl time.Duration) *Cache {
	if ttl <= 0 {
		ttl = time.Hour
	}
	return &Cache{
		entries: make(map[string]cacheEntry),
		ttl:     ttl,
		now:     time.Now,
	}
}

func (c *Cache) Get(username string) (cacheEntry, bool) {
	c.mu.RLock()
	entry, ok := c.entries[username]
	c.mu.RUnlock()
	if !ok {
		return cacheEntry{}, false
	}
	age := c.now().UnixMilli() - entry.CachedAt
	if age < 0 || time.Duration(age)*time.Millisecond > c.ttl {
		c.Delete(username)
		return cacheEntry{}, false
	}
	return entry, true
}

func (c *Cache) Set(entry cacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.entries) >= maxCacheEntries {
		now := c.now().UnixMilli()
		ttlMs := c.ttl.Milliseconds()
		for k, existing := range c.entries {
			if now-existing.CachedAt > ttlMs {
				delete(c.entries, k)
			}
		}
		for k := range c.entries {
			if len(c.entries) < maxCacheEntries/2 {
				break
			}
			delete(c.entries, k)
		}
	}
	c.entries[entry.Username] = entry
}

func (c *Cache) Delete(username string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, username)
}
