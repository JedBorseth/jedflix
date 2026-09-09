package abb

import (
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestSearchUsesTitleAuthorFilter(t *testing.T) {
	var gotQuery string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.RawQuery == "" {
			_, _ = io.WriteString(w, `<html><head><title>Unabridged Audiobooks Free Download</title></head></html>`)
			return
		}
		gotQuery = r.URL.RawQuery
		_, _ = io.WriteString(w, `<html><head><title>Dune Audiobook</title></head><body>
		<div class="post"><div class="postTitle"><h2><a href="/abss/dune/" rel="bookmark">Dune - Frank Herbert</a></h2></div></div>
		</body></html>`)
	}))
	t.Cleanup(srv.Close)

	httpClient := &http.Client{
		Transport: rewriteHost{target: srv.URL, base: srv.Client().Transport},
	}
	results, err := NewClient("https://audiobookbay.lu", httpClient).Search("Dune")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 || results[0].Title != "Dune - Frank Herbert" {
		t.Fatalf("unexpected results: %#v", results)
	}
	if !strings.Contains(gotQuery, "s=dune") {
		t.Fatalf("search query missing s=: %q", gotQuery)
	}
	if !strings.Contains(gotQuery, "tt=1") {
		t.Fatalf("ABB header search without tt=1 returns mixed homepage posts; expected Title & Author filter, got %q", gotQuery)
	}
}

func TestParseSearchHTMLCurrentMarkup(t *testing.T) {
	html := `<html><head><title>Project Hail Mary Audiobook</title></head><body>
	<div class="post"><div class="postTitle"><h2><a href="/abss/prokject-hail-mary-andy-weir/" rel="bookmark">Project Hail Mary - Andy Weir</a></h2></div>
	<div class="postInfo">Category: Sci-Fi</div>
	<div class="postContent"><p>Shared by:cxh22</p></div>
	<div class="postMeta">
		<span class="postLink"><a href="https://audiobookbay.lu/abss/prokject-hail-mary-andy-weir/">Audiobook Details</a></span>
		<span class="postComments"><a href="/dload-now?ll=84Andy_Weir" rel="nofollow">Direct Download</a></span>
	</div></div>
	</body></html>`

	results, err := ParseSearchHTML(html, "https://audiobookbay.lu")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %#v", results)
	}
	if results[0].Title != "Project Hail Mary - Andy Weir" {
		t.Fatalf("unexpected title: %s", results[0].Title)
	}
	if results[0].URL != "https://audiobookbay.lu/abss/prokject-hail-mary-andy-weir/" {
		t.Fatalf("unexpected url: %s", results[0].URL)
	}
}

func TestParseSearchHTML(t *testing.T) {
	html := `<html><body>
    <div class="post">
      <div class="postTitle">
        <h2><a href="/abss/harry-potter-stone/">Harry Potter and the Stone</a></h2>
      </div>
      <div class="postInfo">Fantasy · M4B · 128 Kbps</div>
    </div>
    <div class="post">
      <div class="postTitle">
        <h2><a href="/abss/other-book/">Other Book Title</a></h2>
      </div>
    </div>
  </body></html>`

	results, err := ParseSearchHTML(html, "https://audiobookbay.lu")
	if err != nil {
		t.Fatal(err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if results[0].Title != "Harry Potter and the Stone" {
		t.Fatalf("unexpected title: %s", results[0].Title)
	}
	if results[0].URL != "https://audiobookbay.lu/abss/harry-potter-stone/" {
		t.Fatalf("unexpected url: %s", results[0].URL)
	}
}

func TestParsePostHTMLMagnetLink(t *testing.T) {
	html := `<html><head><meta property="og:title" content="Harry Potter and the Stone" /></head>
  <body>
    <h1>Harry Potter and the Stone</h1>
    <div class="postContent">
      <a href="magnet:?xt=urn:btih:DEADBEEF1234567890ABCDEF1234567890ABCDEF">Download</a>
    </div>
  </body></html>`

	post, err := ParsePostHTML(html, "https://audiobookbay.lu/abss/harry-potter-stone/")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(post.Magnet, "magnet:") {
		t.Fatalf("expected magnet, got %q", post.Magnet)
	}
	if post.Title != "Harry Potter and the Stone" {
		t.Fatalf("unexpected title: %s", post.Title)
	}
}

func TestParsePostHTMLInfoHash(t *testing.T) {
	html := `<html><body>
    <h1>Project Hail Mary - Andy Weir</h1>
    <table>
      <tr><td>Announce URL:</td><td>http://googer.cc:1337/announce</td></tr>
      <tr><td>Tracker:</td><td>udp://tracker.opentrackr.org:1337/announce</td></tr>
      <tr><td>Info Hash:</td><td>ad5fae5ffda056f9f45131045d140326bbafc4dc</td></tr>
      <tr>
        <td>Torrent Download</td>
        <td><a href="/downld0?downfs=84Andy_Weir___Project_Hail_Mary">Torrent Free Downloads</a></td>
        <td style="display:none;"></td>
      </tr>
    </table>
  </body></html>`

	post, err := ParsePostHTML(html, "https://audiobookbay.lu/abss/prokject-hail-mary-andy-weir/")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(post.Magnet, "magnet:?xt=urn:btih:ad5fae5ffda056f9f45131045d140326bbafc4dc") {
		t.Fatalf("unexpected magnet prefix: %q", post.Magnet)
	}
	if !strings.Contains(post.Magnet, "tr=") {
		t.Fatalf("expected tracker in magnet, got %q", post.Magnet)
	}
	if !strings.Contains(post.Magnet, "dn=") {
		t.Fatalf("expected display name in magnet, got %q", post.Magnet)
	}
}

func TestParsePostHTMLMissingMagnet(t *testing.T) {
	html := `<html><body><h1>No Hash Here</h1><p>Nothing useful</p></body></html>`
	_, err := ParsePostHTML(html, "https://audiobookbay.lu/abss/missing/")
	if err == nil {
		t.Fatal("expected error when magnet/hash missing")
	}
}

func TestLooksLikeHomepage(t *testing.T) {
	home := `<html><head><title>Unabridged Audiobooks Free Download</title></head></html>`
	if !looksLikeHomepage(home, "project hail mary") {
		t.Fatal("expected homepage detection")
	}
	ok := `<html><head><title>Project Hail Mary Audiobook</title></head></html>`
	if looksLikeHomepage(ok, "project hail mary") {
		t.Fatal("did not expect homepage detection for real search title")
	}
}

func TestRankResults(t *testing.T) {
	results := []SearchResult{
		{Title: "Completely Unrelated Sci-Fi Epic", URL: "a"},
		{Title: "Harry Potter and the Sorcerer's Stone [Audiobook]", URL: "b"},
		{Title: "Harry Potter Stone Narrated", URL: "c"},
	}
	ranked := RankResults(results, "Harry Potter and the Stone", "J.K. Rowling", 10)
	if len(ranked) == 0 {
		t.Fatal("expected ranked results")
	}
	if ranked[0].URL != "b" && ranked[0].URL != "c" {
		t.Fatalf("expected potter match first, got %#v", ranked[0])
	}
}

type rewriteHost struct {
	target string
	base   http.RoundTripper
}

func (r rewriteHost) RoundTrip(req *http.Request) (*http.Response, error) {
	target, err := url.Parse(r.target)
	if err != nil {
		return nil, err
	}
	clone := req.Clone(req.Context())
	clone.URL.Scheme = target.Scheme
	clone.URL.Host = target.Host
	clone.Host = target.Host
	return r.base.RoundTrip(clone)
}
