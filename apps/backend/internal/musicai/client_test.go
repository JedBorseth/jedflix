package musicai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestEmbedAndRerank(t *testing.T) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/v1/embed", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Texts []string `json:"texts"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatal(err)
		}
		vecs := make([][]float32, len(req.Texts))
		for i := range req.Texts {
			vecs[i] = []float32{0.1, 0.2}
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"embeddings": vecs, "dim": 2, "device": "cpu"})
	})
	mux.HandleFunc("/v1/rerank", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": []map[string]any{{"id": "b", "score": 0.9}, {"id": "a", "score": 0.1}},
			"device":  "cpu",
		})
	})
	srv := httptest.NewServer(mux)
	t.Cleanup(srv.Close)

	client := New(srv.URL)
	if !client.Ready(context.Background()) {
		t.Fatal("expected ready")
	}
	vecs, err := client.Embed(context.Background(), []string{"hello"}, true)
	if err != nil || len(vecs) != 1 {
		t.Fatalf("embed: %v %+v", err, vecs)
	}
	ranked, err := client.Rerank(context.Background(), "q", []RerankDocument{{ID: "a", Text: "A"}, {ID: "b", Text: "B"}})
	if err != nil || ranked[0].ID != "b" {
		t.Fatalf("rerank: %v %+v", err, ranked)
	}
}

func TestNewEmpty(t *testing.T) {
	if New("") != nil {
		t.Fatal("empty url should be nil client")
	}
}
