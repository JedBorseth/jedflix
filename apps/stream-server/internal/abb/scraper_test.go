package abb

import (
	"strings"
	"testing"
)

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
      <tr><td>Tracker:</td><td>udp://tracker.opentrackr.org:1337/announce</td></tr>
      <tr><td>Info Hash:</td><td>ad5fae5ffda056f9f45131045d140326bbafc4dc</td></tr>
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
