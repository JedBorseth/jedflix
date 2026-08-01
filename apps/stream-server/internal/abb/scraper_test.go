package abb

import (
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

func TestParsePostHTML(t *testing.T) {
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
	if !stringsHasPrefix(post.Magnet, "magnet:") {
		t.Fatalf("expected magnet, got %q", post.Magnet)
	}
	if post.Title != "Harry Potter and the Stone" {
		t.Fatalf("unexpected title: %s", post.Title)
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

func stringsHasPrefix(s, prefix string) bool {
	return len(s) >= len(prefix) && s[:len(prefix)] == prefix
}
