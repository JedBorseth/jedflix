// Package bookchapters finds chapter markers for single-file audiobooks.
//
// Most .m4b (and some .mp3) rips carry chapter markers in the container;
// ffprobe reads them from the file header with range requests, without
// downloading the audio. When a file has none, Audible's chapter list (via
// Audnexus) is used, but only if its runtime matches the file's.
package bookchapters

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/url"
	"os/exec"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	SourceEmbedded = "embedded"
	SourceAudible  = "audible"

	defaultAudibleBase = "https://api.audible.com/1.0"
	defaultAudnexBase  = "https://api.audnex.us"

	probeTimeout   = 15 * time.Second
	lookupTimeout  = 8 * time.Second
	cacheMaxItems  = 2000
	minChapterSecs = 1
)

type Chapter struct {
	Title    string  `json:"title"`
	StartSec float64 `json:"startSec"`
	EndSec   float64 `json:"endSec"`
}

type Result struct {
	Chapters    []Chapter
	Source      string
	DurationSec float64
}

// Lookup describes one audio file. Key must be stable for the file's bytes
// (info hash + file id), since results are cached by it.
type Lookup struct {
	Key    string
	URL    string
	Title  string
	Author string
	// AllowCatalog enables the Audible fallback. Only a whole book in one
	// file can line up with a catalog chapter list.
	AllowCatalog bool
}

// ProbeFunc reads container metadata for a URL.
type ProbeFunc func(ctx context.Context, url string) (*Probe, error)

type Probe struct {
	DurationSec float64
	Chapters    []Chapter
}

type Finder struct {
	probe       ProbeFunc
	httpClient  *http.Client
	audibleBase string
	audnexBase  string

	mu    sync.Mutex
	cache map[string]*Result
}

type Options struct {
	Probe       ProbeFunc
	HTTPClient  *http.Client
	AudibleBase string
	AudnexBase  string
}

func NewFinder(opts Options) *Finder {
	f := &Finder{
		probe:       opts.Probe,
		httpClient:  opts.HTTPClient,
		audibleBase: strings.TrimRight(opts.AudibleBase, "/"),
		audnexBase:  strings.TrimRight(opts.AudnexBase, "/"),
		cache:       make(map[string]*Result),
	}
	if f.probe == nil {
		f.probe = FFProbe
	}
	if f.httpClient == nil {
		f.httpClient = &http.Client{Timeout: lookupTimeout}
	}
	if f.audibleBase == "" {
		f.audibleBase = defaultAudibleBase
	}
	if f.audnexBase == "" {
		f.audnexBase = defaultAudnexBase
	}
	return f
}

// Find returns chapters for the file, or nil when none could be found.
func (f *Finder) Find(ctx context.Context, lookup Lookup) *Result {
	if f == nil || strings.TrimSpace(lookup.URL) == "" {
		return nil
	}
	if cached, ok := f.cached(lookup.Key); ok {
		return nonEmpty(cached)
	}

	probe, err := f.probe(ctx, lookup.URL)
	if err != nil {
		// Transient (network, timeout): try again next play.
		return nil
	}
	result := &Result{DurationSec: probe.DurationSec}
	if chapters := normalize(probe.Chapters, probe.DurationSec); len(chapters) >= 2 {
		result.Chapters = chapters
		result.Source = SourceEmbedded
	} else if lookup.AllowCatalog && probe.DurationSec > 0 {
		chapters, catalogErr := f.catalogChapters(ctx, lookup.Title, lookup.Author, probe.DurationSec)
		if catalogErr != nil {
			return nil
		}
		if len(chapters) >= 2 {
			result.Chapters = chapters
			result.Source = SourceAudible
		}
	}
	f.store(lookup.Key, result)
	return nonEmpty(result)
}

func nonEmpty(result *Result) *Result {
	if result == nil || len(result.Chapters) == 0 {
		return nil
	}
	return result
}

func (f *Finder) cached(key string) (*Result, bool) {
	if key == "" {
		return nil, false
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	result, ok := f.cache[key]
	return result, ok
}

func (f *Finder) store(key string, result *Result) {
	if key == "" {
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.cache) >= cacheMaxItems {
		for existing := range f.cache {
			delete(f.cache, existing)
			if len(f.cache) < cacheMaxItems/2 {
				break
			}
		}
	}
	f.cache[key] = result
}

// normalize sorts chapters, fills missing ends, and drops empty slivers.
func normalize(chapters []Chapter, duration float64) []Chapter {
	out := make([]Chapter, 0, len(chapters))
	for _, chapter := range chapters {
		if chapter.StartSec < 0 || math.IsNaN(chapter.StartSec) {
			continue
		}
		out = append(out, chapter)
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].StartSec < out[j].StartSec })
	for i := range out {
		next := duration
		if i+1 < len(out) {
			next = out[i+1].StartSec
		}
		if out[i].EndSec <= out[i].StartSec || (next > 0 && out[i].EndSec > next) {
			out[i].EndSec = next
		}
	}
	kept := out[:0]
	for _, chapter := range out {
		if chapter.EndSec > 0 && chapter.EndSec-chapter.StartSec < minChapterSecs {
			continue
		}
		chapter.Title = strings.TrimSpace(chapter.Title)
		if chapter.Title == "" {
			chapter.Title = "Chapter " + strconv.Itoa(len(kept)+1)
		}
		kept = append(kept, chapter)
	}
	return kept
}

// FFProbe reads duration and chapter markers with ffprobe.
func FFProbe(ctx context.Context, rawURL string) (*Probe, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, errors.New("chapter probe needs an https URL")
	}
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "ffprobe",
		"-v", "error",
		"-show_chapters",
		"-show_entries", "format=duration",
		"-of", "json",
		parsed.String(),
	)
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("ffprobe: %w", err)
	}
	return parseFFProbe(out)
}

func parseFFProbe(out []byte) (*Probe, error) {
	var payload struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
		Chapters []struct {
			StartTime string            `json:"start_time"`
			EndTime   string            `json:"end_time"`
			Tags      map[string]string `json:"tags"`
		} `json:"chapters"`
	}
	if err := json.Unmarshal(out, &payload); err != nil {
		return nil, err
	}
	probe := &Probe{}
	probe.DurationSec, _ = strconv.ParseFloat(payload.Format.Duration, 64)
	for _, chapter := range payload.Chapters {
		start, startErr := strconv.ParseFloat(chapter.StartTime, 64)
		if startErr != nil {
			continue
		}
		end, _ := strconv.ParseFloat(chapter.EndTime, 64)
		title := chapter.Tags["title"]
		if title == "" {
			title = chapter.Tags["TITLE"]
		}
		probe.Chapters = append(probe.Chapters, Chapter{Title: title, StartSec: start, EndSec: end})
	}
	return probe, nil
}

// catalogChapters finds an Audible edition whose runtime matches the file and
// returns its chapter list.
func (f *Finder) catalogChapters(ctx context.Context, title, author string, duration float64) ([]Chapter, error) {
	keywords := strings.TrimSpace(strings.TrimSpace(title) + " " + strings.TrimSpace(author))
	if keywords == "" {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(ctx, 2*lookupTimeout)
	defer cancel()

	values := url.Values{}
	values.Set("keywords", keywords)
	values.Set("num_results", "10")
	values.Set("products_sort_by", "Relevance")
	values.Set("response_groups", "product_attrs")
	var catalog struct {
		Products []struct {
			ASIN             string `json:"asin"`
			RuntimeLengthMin int    `json:"runtime_length_min"`
		} `json:"products"`
	}
	if err := f.getJSON(ctx, f.audibleBase+"/catalog/products?"+values.Encode(), &catalog); err != nil {
		return nil, err
	}

	// Runtime is in whole minutes; anything further off is another edition.
	type candidate struct {
		asin string
		diff float64
	}
	candidates := make([]candidate, 0, len(catalog.Products))
	for _, product := range catalog.Products {
		if product.ASIN == "" || product.RuntimeLengthMin <= 0 {
			continue
		}
		diff := math.Abs(float64(product.RuntimeLengthMin)*60 - duration)
		if diff <= runtimeTolerance(duration)+60 {
			candidates = append(candidates, candidate{asin: product.ASIN, diff: diff})
		}
	}
	sort.SliceStable(candidates, func(i, j int) bool { return candidates[i].diff < candidates[j].diff })
	if len(candidates) > 3 {
		candidates = candidates[:3]
	}

	for _, candidate := range candidates {
		var book struct {
			RuntimeLengthMs float64 `json:"runtimeLengthMs"`
			Chapters        []struct {
				Title         string  `json:"title"`
				StartOffsetMs float64 `json:"startOffsetMs"`
				LengthMs      float64 `json:"lengthMs"`
			} `json:"chapters"`
		}
		if err := f.getJSON(ctx, f.audnexBase+"/books/"+url.PathEscape(candidate.asin)+"/chapters", &book); err != nil {
			continue
		}
		if math.Abs(book.RuntimeLengthMs/1000-duration) > runtimeTolerance(duration) {
			continue
		}
		chapters := make([]Chapter, 0, len(book.Chapters))
		for _, chapter := range book.Chapters {
			start := chapter.StartOffsetMs / 1000
			chapters = append(chapters, Chapter{
				Title:    chapter.Title,
				StartSec: start,
				EndSec:   start + chapter.LengthMs/1000,
			})
		}
		if normalized := normalize(chapters, duration); len(normalized) >= 2 {
			return normalized, nil
		}
	}
	return nil, nil
}

// runtimeTolerance allows trimmed intros/outros without matching a different
// edition (abridged, other narrator).
func runtimeTolerance(duration float64) float64 {
	return math.Max(90, duration*0.005)
}

func (f *Finder) getJSON(ctx context.Context, target string, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	res, err := f.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusNotFound {
		return errNotFound
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("%s returned %d", req.URL.Host, res.StatusCode)
	}
	return json.NewDecoder(res.Body).Decode(out)
}

var errNotFound = errors.New("not found")
