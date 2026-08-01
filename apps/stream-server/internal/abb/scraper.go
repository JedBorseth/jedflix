package abb

import (
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/PuerkitoBio/goquery"
)

const DefaultBaseURL = "https://audiobookbay.lu"

var magnetRE = regexp.MustCompile(`(?i)magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^\s"'<>]*`)

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
	httpClient *http.Client
	cache      *searchCache
}

func NewClient(baseURL string, httpClient *http.Client) *Client {
	base := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if base == "" {
		base = DefaultBaseURL
	}
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}
	return &Client{
		baseURL:    base,
		httpClient: httpClient,
		cache:      newSearchCache(30 * time.Minute),
	}
}

func (c *Client) Search(query string) ([]SearchResult, error) {
	q := strings.TrimSpace(query)
	if q == "" {
		return nil, fmt.Errorf("query is required")
	}

	if cached, ok := c.cache.get(q); ok {
		return cached, nil
	}

	html, err := c.fetchHTML("/?s=" + url.QueryEscape(q))
	if err != nil {
		return nil, err
	}

	results, err := ParseSearchHTML(html, c.baseURL)
	if err != nil {
		return nil, err
	}
	if len(results) > 40 {
		results = results[:40]
	}
	c.cache.set(q, results)
	return results, nil
}

func (c *Client) GetPost(postURL string) (*PostDetail, error) {
	html, err := c.fetchHTML(postURL)
	if err != nil {
		return nil, err
	}
	return ParsePostHTML(html, postURL)
}

func (c *Client) fetchHTML(pathOrURL string) (string, error) {
	target := pathOrURL
	if !strings.HasPrefix(pathOrURL, "http://") && !strings.HasPrefix(pathOrURL, "https://") {
		target = c.baseURL + pathOrURL
	}

	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; JedFlix/1.0)")
	req.Header.Set("Accept", "text/html")

	res, err := c.httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(res.Body, 512))
		return "", fmt.Errorf("AudiobookBay fetch failed: %d %s", res.StatusCode, strings.TrimSpace(string(body)))
	}

	body, err := io.ReadAll(res.Body)
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
	if !strings.HasPrefix(magnet, "magnet:") {
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
