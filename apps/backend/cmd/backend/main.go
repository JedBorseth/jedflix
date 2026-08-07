package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/abb"
	"github.com/jedborseth/jeds-movies/backend/internal/api"
	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/backend/internal/openlibrary"
	"github.com/jedborseth/jeds-movies/backend/internal/realdebrid"
	"github.com/jedborseth/jeds-movies/backend/internal/resolver"
	"github.com/jedborseth/jeds-movies/backend/internal/search"
	"github.com/jedborseth/jeds-movies/backend/internal/spotify"
	"github.com/jedborseth/jeds-movies/backend/internal/youtube"
)

func main() {
	config.LoadEnvFiles()
	cfg := config.Load()
	if cfg.RequireAPIKey && cfg.BackendAPIKey == "" {
		log.Fatal("BACKEND_API_KEY is required (set REQUIRE_API_KEY=false to allow open local access)")
	}
	if cfg.RealDebridToken == "" {
		log.Println("note: REALDEBRID_TOKEN is unused for resolve; clients send their own Real Debrid key")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	searcher := search.NewTorrentioSearcher(cfg)
	rd := realdebrid.NewClient(cfg)
	abbClient := abb.NewClientWithOptions(abb.ClientOptions{
		BaseURL:    cfg.AbbBaseURL,
		Username:   cfg.AbbUsername,
		Password:   cfg.AbbPassword,
		HTTPClient: cfg.HTTPClient(),
	})
	if cfg.AbbUsername != "" {
		log.Printf("AudiobookBay login configured for user %q", cfg.AbbUsername)
	}
	resolverService := resolver.NewService(cfg, searcher, rd, abbClient)
	letterboxdClient := letterboxd.NewClient(cfg)
	openLibraryClient := openlibrary.NewClient(cfg)
	openLibraryClient.Start(ctx)
	spotifyClient := spotify.NewClient(cfg)
	if spotifyClient.Configured() {
		log.Println("Spotify client credentials configured")
	} else {
		log.Println("warning: SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET not set; music catalog disabled")
	}
	spotifyClient.Start(ctx)

	youtubeResolver := youtube.NewResolver()
	server := api.NewServer(cfg, resolverService, letterboxdClient, openLibraryClient, spotifyClient, youtubeResolver)
	httpServer := &http.Server{
		Addr:              cfg.Addr,
		Handler:           server.Router(),
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       60 * time.Second,
		// WriteTimeout left unset: YouTube audio and long resolve responses stream.
	}

	go func() {
		log.Printf("backend listening on %s", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Println(err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	log.Println("backend shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("backend shutdown error: %v", err)
		os.Exit(1)
	}
}
