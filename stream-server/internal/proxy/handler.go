package proxy

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

type Handler struct {
	signer *Signer
	client *http.Client
}

func NewHandler(signer *Signer, client *http.Client) *Handler {
	return &Handler{
		signer: signer,
		client: client,
	}
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimPrefix(r.URL.Path, "/api/v1/proxy/")
	if token == "" || token == r.URL.Path {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}

	payload, err := h.signer.Verify(token)
	if err != nil {
		http.Error(w, "invalid or expired token", http.StatusUnauthorized)
		return
	}

	upstreamReq, err := http.NewRequestWithContext(r.Context(), http.MethodGet, payload.URL, nil)
	if err != nil {
		http.Error(w, "failed to create upstream request", http.StatusInternalServerError)
		return
	}

	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		upstreamReq.Header.Set("Range", rangeHeader)
	}
	upstreamReq.Header.Set("User-Agent", "JedFlix-Stream-Proxy/1.0")

	resp, err := h.client.Do(upstreamReq)
	if err != nil {
		http.Error(w, "upstream request failed", http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	copyHeader := func(key string) {
		if value := resp.Header.Get(key); value != "" {
			w.Header().Set(key, value)
		}
	}
	copyHeader("Content-Type")
	copyHeader("Content-Length")
	copyHeader("Content-Range")
	copyHeader("Accept-Ranges")
	w.Header().Set("Access-Control-Expose-Headers", "Content-Range, Accept-Ranges, Content-Length")

	if filename := payload.Filename; filename != "" {
		w.Header().Set("Content-Disposition", fmt.Sprintf(`inline; filename="%s"`, filename))
	}

	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, resp.Body)
}
