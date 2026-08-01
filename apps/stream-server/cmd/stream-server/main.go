package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/jedborseth/jeds-movies/stream-server/internal/abb"
	"github.com/jedborseth/jeds-movies/stream-server/internal/api"
	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/stream-server/internal/openlibrary"
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

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	searcher := search.NewTorrentioSearcher(cfg)
	rd := realdebrid.NewClient(cfg)
	abbClient := abb.NewClient(cfg.AbbBaseURL, cfg.HTTPClient())
	resolverService := resolver.NewService(cfg, searcher, rd, abbClient)
	letterboxdClient := letterboxd.NewClient(cfg)
	openLibraryClient := openlibrary.NewClient(cfg)
	openLibraryClient.Start(ctx)

	server := api.NewServer(cfg, resolverService, letterboxdClient, openLibraryClient)
	log.Printf("stream-server listening on %s", cfg.Addr)
	if err := http.ListenAndServe(cfg.Addr, server.Router()); err != nil {
		log.Println(err)
		os.Exit(1)
	}
}
