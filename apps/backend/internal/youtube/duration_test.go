package youtube

import (
	"fmt"
	"net/http/httptest"
	"testing"
)

func TestDurationMsFromSeconds(t *testing.T) {
	if got := DurationMsFromSeconds(185.4); got != 185400 {
		t.Fatalf("got %d", got)
	}
	if got := DurationMsFromSeconds(0); got != 0 {
		t.Fatalf("zero => %d", got)
	}
	if got := DurationMsFromSeconds(-1); got != 0 {
		t.Fatalf("negative => %d", got)
	}
}

func TestDurationMsFromStreamURL(t *testing.T) {
	raw := "https://rr1---sn-abc.googlevideo.com/videoplayback?id=1&dur=210.55&clen=9"
	if got := DurationMsFromStreamURL(raw); got != 210550 {
		t.Fatalf("got %d", got)
	}
	if got := DurationMsFromStreamURL("https://example.com/a"); got != 0 {
		t.Fatalf("missing dur => %d", got)
	}
}

func TestWriteMetadataHeaders(t *testing.T) {
	rec := httptest.NewRecorder()
	WriteMetadataHeaders(rec, &StreamInfo{
		DurationMs:  181000,
		Ext:         "m4a",
		ContentType: "audio/mp4",
	})
	if rec.Header().Get(HeaderDurationMs) != "181000" {
		t.Fatalf("duration header = %q", rec.Header().Get(HeaderDurationMs))
	}
	if rec.Header().Get(HeaderExt) != "m4a" {
		t.Fatalf("ext header = %q", rec.Header().Get(HeaderExt))
	}
	if rec.Header().Get("Content-Type") != "audio/mp4" {
		t.Fatalf("content-type = %q", rec.Header().Get("Content-Type"))
	}
}

func TestLooksLikeAudioContentType(t *testing.T) {
	if !looksLikeAudioContentType("audio/mp4") {
		t.Fatal("audio/mp4 should pass")
	}
	if looksLikeAudioContentType("text/html") {
		t.Fatal("html error pages are not audio")
	}
	if looksLikeAudioContentType("application/json") {
		t.Fatal("json is not audio")
	}
}

func TestIsRetryableProxyError(t *testing.T) {
	if !IsRetryableProxyError(fmt.Errorf("%w: upstream status 403", ErrResolveFail)) {
		t.Fatal("403 should be retryable")
	}
	if IsRetryableProxyError(ErrNotFound) {
		t.Fatal("not found is not retryable")
	}
}
