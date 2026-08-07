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
	"github.com/jedborseth/jeds-movies/backend/internal/lastfm"
	"github.com/jedborseth/jeds-movies/backend/internal/letterboxd"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
	"github.com/jedborseth/jeds-movies/backend/internal/musicsearch"
	"github.com/jedborseth/jeds-movies/backend/internal/openlibrary"
	"github.com/jedborseth/jeds-movies/backend/internal/realdebrid"
	"github.com/jedborseth/jeds-movies/backend/internal/resolver"
	"github.com/jedborseth/jeds-movies/backend/internal/search"
	"github.com/jedborseth/jeds-movies/backend/internal/tmdb"
	"github.com/jedborseth/jeds-movies/backend/internal/youtube"
)

func main() {
	config.LoadEnvFiles()
	cfg := config.Load()

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

	musicClient := musicbrainz.NewClient(cfg)
	if cfg.MusicBrainzDatabaseURL != "" {
		store, err := local.Open(cfg.MusicBrainzDatabaseURL)
		if err != nil {
			log.Printf("warning: local MusicBrainz database unavailable: %v", err)
		} else {
			musicClient.SetLocalStore(store)
			log.Println("MusicBrainz local Postgres replica enabled")
			defer store.Close()
		}
	}
	if cfg.MeiliURL != "" {
		searchClient, err := musicsearch.New(cfg.MeiliURL, cfg.MeiliAPIKey)
		if err != nil {
			log.Printf("warning: Meilisearch unavailable: %v", err)
		} else {
			musicClient.SetSearch(searchClient)
			log.Printf("Music search: Meilisearch at %s", cfg.MeiliURL)
		}
	}
	if musicClient.LocalEnabled() {
		log.Println("Music catalog: local MusicBrainz + Meilisearch (public MB API unused for search/detail)")
	} else {
		log.Println("Music catalog provider: MusicBrainz API (+ Cover Art Archive) — set MUSICBRAINZ_DATABASE_URL + MEILI_URL for local mode")
	}
	if cfg.MusicArtworkPath != "" {
		log.Printf("Music artwork cache path: %s", cfg.MusicArtworkPath)
	}
	lastfmClient := lastfm.NewClient(cfg)
	if lastfmClient.Configured() {
		musicClient.SetEnricher(lastfm.NewEnricher(lastfmClient))
		log.Println("Last.fm API key configured (charts, top tracks, artist images)")
	} else {
		log.Println("warning: LASTFM_API_KEY not set; catalog shelves use MusicBrainz seeds only")
	}
	if cfg.MusicCatalogPath != "" {
		log.Printf("Music catalog persist path: %s", cfg.MusicCatalogPath)
	}
	musicClient.Start(ctx)

	lastfmService := lastfm.NewService(lastfmClient, musicClient)
	if lastfmService.Configured() {
		log.Println("Last.fm recommendations enabled")
	} else {
		log.Println("warning: LASTFM_API_KEY not set; related music recommendations disabled")
	}

	tmdbClient := tmdb.NewClient(cfg)
	if tmdbClient.Configured() {
		log.Println("TMDB API key configured (proxied via /api/v1/tmdb)")
	} else {
		log.Println("warning: TMDB_API_KEY not set; movie/TV catalog disabled")
	}

	youtubeResolver := youtube.NewResolver()
	server := api.NewServer(cfg, resolverService, letterboxdClient, openLibraryClient, musicClient, lastfmService, youtubeResolver, tmdbClient)
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
