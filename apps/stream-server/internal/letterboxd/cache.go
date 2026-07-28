package letterboxd

import (
	"sync"
	"time"
)

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
	defer c.mu.RUnlock()
	entry, ok := c.entries[username]
	if !ok {
		return cacheEntry{}, false
	}
	age := c.now().UnixMilli() - entry.CachedAt
	if age < 0 || time.Duration(age)*time.Millisecond > c.ttl {
		return cacheEntry{}, false
	}
	return entry, true
}

func (c *Cache) Set(entry cacheEntry) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[entry.Username] = entry
}

func (c *Cache) Delete(username string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, username)
}
