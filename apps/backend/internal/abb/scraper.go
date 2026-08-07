package abb

import (
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const DefaultBaseURL = "https://audiobookbay.lu"

// ABB silently ignores Title-Case queries and returns the homepage instead.
// Always search with a lowercased query string.
var (
	magnetRE   = regexp.MustCompile(`(?i)magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s"'<>]*`)
	infoHashRE = regexp.MustCompile(`(?is)Info\s*Hash:\s*</t[dh]>\s*<t[dh][^>]*>\s*([a-fA-F0-9]{40})\s*</t[dh]>`)
	hexHashRE  = regexp.MustCompile(`\b([a-fA-F0-9]{40})\b`)
	trackerRE  = regexp.MustCompile(`(?i)\b(?:udp|http|https)://[^\s<>"']+`)
)

const browserUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"

type SearchResult struct {
	Title string `json:"title"`
	URL   string `json:"url"`
	Info  string `json:"info,omitempty"`
}

type PostDetail struct {
	Title  string `json:"title"`
	URL    string `json:"url"`
	Magnet string `json:"magnet"`
	Info   string `json:"info,omitempty"`
}

type Client struct {
	baseURL    string
	username   string
	password   string
	httpClient *http.Client
	cache      *searchCache

	loginMu    sync.Mutex
	loggedIn   bool
	loginTried bool
	loginErr   error
}

type ClientOptions struct {
	BaseURL    string
	Username   string
	Password   string
	HTTPClient *http.Client
}

func NewClient(baseURL string, httpClient *http.Client) *Client {
	return NewClientWithOptions(ClientOptions{
		BaseURL:    baseURL,
		HTTPClient: httpClient,
	})
}

func NewClientWithOptions(opts ClientOptions) *Client {
	base := strings.TrimRight(strings.TrimSpace(opts.BaseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}

	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 25 * time.Second}
	}
	// Clone so we can attach a cookie jar without mutating a shared client.
	cloned := *httpClient
	if cloned.Jar == nil {
		jar, err := cookiejar.New(nil)
		if err == nil {
			cloned.Jar = jar
		}
	}
	// Keep ABB page fetches bounded so resolve jobs fail fast with a clear error
	// instead of hanging until mobile browsers report "Load failed".
	if cloned.Timeout == 0 || cloned.Timeout > 25*time.Second {
		cloned.Timeout = 25 * time.Second
	}

	return &Client{
		baseURL:    base,
		username:   strings.TrimSpace(opts.Username),
		password:   opts.Password,
		httpClient: &cloned,
		cache:      newSearchCache(30 * time.Minute),
	}
}

func (c *Client) Search(query string) ([]SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, fmt.Errorf("query is required")
	}
	// ABB's search endpoint fails open to the homepage for Title Case queries.
	q = strings.ToLower(q)

	if cached, ok := c.cache.get(q); ok {
		return cached, nil
	}

	if err := c.ensureSession(); err != nil {
		// Session/login failure shouldn't block anonymous search.
		_ = err
	}

	results, err := c.searchOnce(q)
	if err != nil {
		return nil, err
	}
	if len(results) > 40 {
		results = results[:40]
	}
	c.cache.set(q, results)
	return results, nil
}

func (c *Client) searchOnce(queryLower string) ([]SearchResult, error) {
	html, err := c.fetchHTML("/?s=" + url.QueryEscape(queryLower))
	if err != nil {
		return nil, err
	}
	if looksLikeHomepage(html, queryLower) {
		return nil, fmt.Errorf("AudiobookBay returned the homepage instead of search results for %q", queryLower)
	}
	return ParseSearchHTML(html, c.baseURL)
}

func (c *Client) GetPost(postURL string) (*PostDetail, error) {
	if err := c.ensureSession(); err != nil {
		_ = err
	}
	html, err := c.fetchHTML(postURL)
	if err != nil {
		return nil, err
	}
	return ParsePostHTML(html, postURL)
}

func (c *Client) ensureSession() error {
	c.loginMu.Lock()
	defer c.loginMu.Unlock()

	if c.loggedIn {
		return nil
	}
	if c.username == "" || c.password == "" {
		// Warm a PHPSESSID anonymously — some ABB responses behave better with one.
		_, err := c.fetchHTML("/")
		return err
	}
	if c.loginTried {
		return c.loginErr
	}
	c.loginTried = true
	c.loginErr = c.loginLocked()
	if c.loginErr == nil {
		c.loggedIn = true
	}
	return c.loginErr
}

func (c *Client) loginLocked() error {
	// Hit login page first for cookies.
	if _, err := c.fetchHTML("/member/login"); err != nil {
		return fmt.Errorf("ABB login page: %w", err)
	}

	form := url.Values{}
	form.Set("username", c.username)
	form.Set("password", c.password)

	req, err := http.NewRequest(http.MethodPost, c.baseURL+"/member/login.php", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Referer", c.baseURL+"/member/login")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("ABB login request: %w", err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 256*1024))
	html := string(body)

	lower := strings.ToLower(html)
	if strings.Contains(lower, "logout") || strings.Contains(lower, "member/users") {
		return nil
	}
	if res.StatusCode >= 200 && res.StatusCode < 400 {
		// Follow-up check: member area should show logout when authenticated.
		check, checkErr := c.fetchHTML("/member/users/")
		if checkErr == nil && strings.Contains(strings.ToLower(check), "logout") {
			return nil
		}
	}
	return fmt.Errorf("ABB login failed (status %d)", res.StatusCode)
}

func (c *Client) fetchHTML(pathOrURL string) (string, error) {
	target, err := c.validateFetchURL(pathOrURL)
	if err != nil {
		return "", err
	}

	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", browserUA)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return "", fmt.Errorf("AudiobookBay fetch failed: %d %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(io.LimitReader(res.Body, 2<<20)) // 2 MiB cap
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func ParseSearchHTML(html, baseURL string) ([]SearchResult, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, err
	}

	results := make([]SearchResult, 0)
	seen := map[string]struct{}{}

	doc.Find("div.post").Each(func(_ int, post *goquery.Selection) {
		link := post.Find("h2 a, .postTitle a").First()
		title := strings.TrimSpace(link.Text())
		href, ok := link.Attr("href")
		if !ok || title == "" || href == "" {
			return
		}
		absolute := absolutize(href, baseURL)
		if _, exists := seen[absolute]; exists {
			return
		}
		seen[absolute] = struct{}{}
		info := strings.TrimSpace(post.Find(".postInfo, .postContent").First().Text())
		if len(info) > 300 {
			info = info[:300]
		}
		results = append(results, SearchResult{
			Title: title,
			URL:   absolute,
			Info:  info,
		})
	})

	if len(results) == 0 {
		doc.Find(`a[href*="/abss/"], a[href*="/audio-books/"]`).Each(func(_ int, link *goquery.Selection) {
			title := strings.TrimSpace(link.Text())
			href, ok := link.Attr("href")
			if !ok || title == "" || len(title) < 4 || href == "" {
				return
			}
			absolute := absolutize(href, baseURL)
			if _, exists := seen[absolute]; exists {
				return
			}
			seen[absolute] = struct{}{}
			results = append(results, SearchResult{Title: title, URL: absolute})
		})
	}

	return results, nil
}

func ParsePostHTML(html, postURL string) (*PostDetail, error) {
	doc, err := goquery.NewDocumentFromReader(strings.NewReader(html))
	if err != nil {
		return nil, err
	}

	title := strings.TrimSpace(doc.Find("h1").First().Text())
	if title == "" {
		if og, ok := doc.Find(`meta[property="og:title"]`).Attr("content"); ok {
			title = strings.TrimSpace(og)
		}
	}
	if title == "" {
		title = "Unknown"
	}

	magnet := extractMagnet(html, doc)
	if magnet == "" {
		return nil, fmt.Errorf("no magnet link found on this AudiobookBay post")
	}

	info := strings.TrimSpace(doc.Find(".postContent, #content, article").First().Text())
	if len(info) > 500 {
		info = info[:500]
	}

	return &PostDetail{
		Title:  title,
		URL:    postURL,
		Magnet: magnet,
		Info:   info,
	}, nil
}

func extractMagnet(html string, doc *goquery.Document) string {
	magnet := ""
	doc.Find(`a[href^="magnet:"]`).EachWithBreak(func(_ int, link *goquery.Selection) bool {
		if href, ok := link.Attr("href"); ok && strings.HasPrefix(href, "magnet:") {
			magnet = href
			return false
		}
		return true
	})

	if magnet == "" {
		doc.Find("textarea").EachWithBreak(func(_ int, area *goquery.Selection) bool {
			text := strings.TrimSpace(area.Text())
			if strings.Contains(text, "magnet:") {
				magnet = text
				return false
			}
			return true
		})
	}

	if magnet == "" {
		if match := magnetRE.FindString(html); match != "" {
			magnet = match
		}
	}

	magnet = strings.TrimSpace(magnet)
	trackers := extractTrackers(html, doc)
	title := strings.TrimSpace(doc.Find("h1").First().Text())

	if strings.HasPrefix(magnet, "magnet:") {
		return enrichMagnet(magnet, title, trackers)
	}

	// ABB no longer exposes magnet: links publicly — build one from the Info Hash table.
	if hash := extractInfoHash(html, doc); hash != "" {
		return buildMagnet(hash, title, trackers)
	}
	return ""
}

func extractTrackers(html string, doc *goquery.Document) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, 12)

	add := func(raw string) {
		tr := strings.TrimSpace(htmlUnescape(raw))
		if tr == "" || !trackerRE.MatchString(tr) {
			return
		}
		// Keep only announce-style tracker URLs when possible.
		if !strings.Contains(strings.ToLower(tr), "announce") && !strings.HasPrefix(strings.ToLower(tr), "udp://") {
			return
		}
		if _, ok := seen[tr]; ok {
			return
		}
		seen[tr] = struct{}{}
		out = append(out, tr)
	}

	doc.Find("tr").Each(func(_ int, row *goquery.Selection) {
		label := strings.ToLower(strings.TrimSpace(row.Find("td").First().Text()))
		if !strings.Contains(label, "tracker") {
			return
		}
		add(row.Find("td").Eq(1).Text())
	})

	if len(out) == 0 {
		for _, match := range trackerRE.FindAllString(html, -1) {
			add(match)
		}
	}

	if len(out) > 15 {
		out = out[:15]
	}
	return out
}

func buildMagnet(hash, title string, trackers []string) string {
	var b strings.Builder
	b.WriteString("magnet:?xt=urn:btih:")
	b.WriteString(strings.ToLower(strings.TrimSpace(hash)))
	if title = strings.TrimSpace(title); title != "" && title != "Unknown" {
		b.WriteString("&dn=")
		b.WriteString(url.QueryEscape(title))
	}
	for _, tr := range trackers {
		b.WriteString("&tr=")
		b.WriteString(url.QueryEscape(tr))
	}
	return b.String()
}

func enrichMagnet(magnet, title string, trackers []string) string {
	if !strings.Contains(magnet, "&tr=") && len(trackers) > 0 {
		hash := hashFromMagnet(magnet)
		if hash != "" {
			return buildMagnet(hash, title, trackers)
		}
	}
	if title != "" && title != "Unknown" && !strings.Contains(magnet, "&dn=") {
		magnet += "&dn=" + url.QueryEscape(title)
	}
	return magnet
}

func hashFromMagnet(magnet string) string {
	lower := strings.ToLower(magnet)
	const prefix = "urn:btih:"
	idx := strings.Index(lower, prefix)
	if idx < 0 {
		return ""
	}
	rest := magnet[idx+len(prefix):]
	end := len(rest)
	for i := 0; i < len(rest); i++ {
		c := rest[i]
		if (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F') {
			continue
		}
		end = i
		break
	}
	return rest[:end]
}

func htmlUnescape(value string) string {
	replacer := strings.NewReplacer(
		"&amp;", "&",
		"&#38;", "&",
		"&lt;", "<",
		"&gt;", ">",
		"&#39;", "'",
		"&quot;", `"`,
	)
	return replacer.Replace(value)
}

func extractInfoHash(html string, doc *goquery.Document) string {
	if match := infoHashRE.FindStringSubmatch(html); len(match) == 2 {
		return match[1]
	}

	var hash string
	doc.Find("tr").EachWithBreak(func(_ int, row *goquery.Selection) bool {
		label := strings.ToLower(strings.TrimSpace(row.Find("td").First().Text()))
		if !strings.Contains(label, "info hash") {
			return true
		}
		value := strings.TrimSpace(row.Find("td").Eq(1).Text())
		if hexHashRE.MatchString(value) {
			hash = hexHashRE.FindString(value)
			return false
		}
		return true
	})
	return hash
}

// looksLikeHomepage detects when ABB ignored the search query and served the front page.
func looksLikeHomepage(html, query string) bool {
	lowerTitle := ""
	if start := strings.Index(strings.ToLower(html), "<title>"); start >= 0 {
		rest := html[start+7:]
		if end := strings.Index(strings.ToLower(rest), "</title>"); end >= 0 {
			lowerTitle = strings.ToLower(strings.TrimSpace(rest[:end]))
		}
	}
	if lowerTitle == "" {
		return false
	}
	if strings.Contains(lowerTitle, "unabridged audiobooks free download") {
		return true
	}
	// Successful searches usually put query tokens into the <title>.
	tokens := strings.Fields(strings.ToLower(query))
	matched := 0
	for _, t := range tokens {
		if len(t) < 3 {
			continue
		}
		if strings.Contains(lowerTitle, t) {
			matched++
		}
	}
	significant := 0
	for _, t := range tokens {
		if len(t) >= 3 {
			significant++
		}
	}
	return significant > 0 && matched == 0
}

func absolutize(href, baseURL string) string {
	if strings.HasPrefix(href, "http://") || strings.HasPrefix(href, "https://") {
		return href
	}
	base := strings.TrimRight(baseURL, "/")
	if strings.HasPrefix(href, "/") {
		return base + href
	}
	return base + "/" + href
}
