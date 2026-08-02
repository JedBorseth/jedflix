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

	"github.com/jedborseth/jeds-movies/stream-server/internal/abb"
	"github.com/jedborseth/jeds-movies/stream-server/internal/api"
	"github.com/jedborseth/jeds-movies/stream-server/internal/config"
	"github.com/jedborseth/jeds-movies/stream-server/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/stream-server/internal/openlibrary"
	"github.com/jedborseth/jeds-movies/stream-server/internal/realdebrid"
	"github.com/jedborseth/jeds-movies/stream-server/internal/resolver"
	"github.com/jedborseth/jeds-movies/stream-server/internal/search"
	"github.com/jedborseth/jeds-movies/stream-server/internal/spotify"
	"github.com/jedborseth/jeds-movies/stream-server/internal/youtube"
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
		Addr:    cfg.Addr,
		Handler: server.Router(),
	}

	go func() {
		log.Printf("stream-server listening on %s", cfg.Addr)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Println(err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	log.Println("stream-server shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := httpServer.Shutdown(shutdownCtx); err != nil {
		log.Printf("stream-server shutdown error: %v", err)
		os.Exit(1)
	}
}
