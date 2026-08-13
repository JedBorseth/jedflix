package musicai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type Client struct {
	baseURL  string
	http     *http.Client
	embedDim int
}

type EmbedResponse struct {
	Embeddings [][]float32 `json:"embeddings"`
	Dim        int         `json:"dim"`
	Device     string      `json:"device"`
}

type RerankDocument struct {
	ID   string `json:"id"`
	Text string `json:"text"`
}

type RerankResult struct {
	ID    string  `json:"id"`
	Score float64 `json:"score"`
}

func New(baseURL string) *Client {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if baseURL == "" {
		return nil
	}
	return &Client{
		baseURL: baseURL,
		http: &http.Client{
			Timeout: 90 * time.Second,
		},
		embedDim: 512,
	}
}

func (c *Client) Configured() bool {
	return c != nil && c.baseURL != ""
}

func (c *Client) Ready(ctx context.Context) bool {
	if !c.Configured() {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/health", nil)
	if err != nil {
		return false
	}
	res, err := c.http.Do(req)
	if err != nil {
		return false
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return false
	}
	var payload struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(res.Body).Decode(&payload); err != nil {
		return false
	}
	return payload.Status == "ok"
}

func (c *Client) Embed(ctx context.Context, texts []string, isQuery bool) ([][]float32, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("music-ai is not configured")
	}
	body, err := json.Marshal(map[string]any{
		"texts":    texts,
		"is_query": isQuery,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/embed", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("music-ai embed: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("music-ai embed status %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var payload EmbedResponse
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	if len(payload.Embeddings) != len(texts) {
		return nil, fmt.Errorf("music-ai embed count mismatch")
	}
	if payload.Dim > 0 {
		c.embedDim = payload.Dim
	}
	return payload.Embeddings, nil
}

func (c *Client) EmbedQuery(ctx context.Context, query string) ([]float32, error) {
	vecs, err := c.Embed(ctx, []string{query}, true)
	if err != nil {
		return nil, err
	}
	if len(vecs) == 0 {
		return nil, fmt.Errorf("music-ai returned no query embedding")
	}
	return vecs[0], nil
}

func (c *Client) Rerank(ctx context.Context, query string, docs []RerankDocument) ([]RerankResult, error) {
	if !c.Configured() {
		return nil, fmt.Errorf("music-ai is not configured")
	}
	if len(docs) == 0 {
		return nil, nil
	}
	if len(docs) > 64 {
		docs = docs[:64]
	}
	body, err := json.Marshal(map[string]any{
		"query":     query,
		"documents": docs,
	})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/rerank", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("music-ai rerank: %w", err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(res.Body, 2<<20))
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("music-ai rerank status %d: %s", res.StatusCode, strings.TrimSpace(string(raw)))
	}
	var payload struct {
		Results []RerankResult `json:"results"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return payload.Results, nil
}

func (c *Client) Dim() int {
	if c == nil || c.embedDim <= 0 {
		return 512
	}
	return c.embedDim
}
