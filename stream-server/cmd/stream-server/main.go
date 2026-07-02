package main

import (
	"log"
	"net/http"
	"os"

	"github.com/jedborseth/jeds-movies/stream-server/internal/api"
	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/proxy"
	"github.com/jedborseth/jeds-movies/stream-server/internal/realdebrid"
	"github.com/jedborseth/jeds-movies/stream-server/internal/resolver"
	"github.com/jedborseth/jeds-movies/stream-server/internal/search"
)

func main() {
	config.LoadEnvFiles()
	cfg := config.Load()
	if cfg.RealDebridToken == "" {
		log.Println("warning: REALDEBRID_TOKEN is not set; copy it to .env.local or stream-server/.env")
	} else {
		log.Printf("Real Debrid token loaded (%d chars)", len(cfg.RealDebridToken))
	}

	searcher := search.NewTorrentioSearcher(cfg)
	rd := realdebrid.NewClient(cfg)
	signer := proxy.NewSigner(cfg.ProxySigningSecret)
	resolverService := resolver.NewService(cfg, searcher, rd, signer)

	proxyClient := cfg.HTTPClient()
	proxyClient.Timeout = 0
	proxyHandler := proxy.NewHandler(signer, proxyClient)

	server := api.NewServer(cfg, resolverService, proxyHandler)
	log.Printf("stream-server listening on %s", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, server.Router()); err != nil {
		log.Println(err)
		os.Exit(1)
	}
}
