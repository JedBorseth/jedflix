package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/musicai"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
)

func main() {
	config.LoadEnvFiles()
	dbURL := os.Getenv("MUSICBRAINZ_DATABASE_URL")
	aiURL := os.Getenv("MUSIC_AI_URL")
	if dbURL == "" {
		log.Fatal("MUSICBRAINZ_DATABASE_URL is required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	store, err := local.Open(dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer store.Close()

	schemaCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	if err := local.EnsureSearchSchema(schemaCtx, store.DB()); err != nil {
		cancel()
		log.Fatalf("search schema: %v", err)
	}
	cancel()

	ai := musicai.New(aiURL)
	docs, embeddings, _ := store.DocumentCounts(ctx)
	if err := populateIfDue(ctx, store, docs < 10000); err != nil {
		log.Fatalf("populate: %v", err)
	}
	docs, embeddings, _ = store.DocumentCounts(ctx)
	log.Printf("search documents=%d embeddings=%d", docs, embeddings)

	batch := 16
	idleDelay := 15 * time.Second
	for {
		if ctx.Err() != nil {
			return
		}
		if ai == nil || !ai.Ready(ctx) {
			log.Println("music-ai not ready; waiting")
			select {
			case <-ctx.Done():
				return
			case <-time.After(idleDelay):
			}
			continue
		}
		missing, err := store.ListMissingEmbeddings(ctx, batch)
		if err != nil {
			log.Printf("list missing embeddings: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(idleDelay):
			}
			continue
		}
		if len(missing) == 0 {
			if err := populateIfDue(ctx, store, false); err != nil {
				log.Printf("populate: %v", err)
			}
			docs, embeddings, _ = store.DocumentCounts(ctx)
			log.Printf("embeddings up to date (%d / %d). sleeping", embeddings, docs)
			select {
			case <-ctx.Done():
				return
			case <-time.After(2 * time.Minute):
			}
			continue
		}
		texts := make([]string, len(missing))
		for i, doc := range missing {
			texts[i] = doc.EmbedText
		}
		vecs, err := ai.Embed(ctx, texts, false)
		if err != nil {
			log.Printf("embed batch: %v", err)
			select {
			case <-ctx.Done():
				return
			case <-time.After(idleDelay):
			}
			continue
		}
		if err := store.SaveEmbeddings(ctx, missing, vecs); err != nil {
			log.Printf("save embeddings: %v", err)
			continue
		}
		docs, embeddings, _ = store.DocumentCounts(ctx)
		log.Printf("embedded %d more (%d / %d)", len(missing), embeddings, docs)
		// Yield the GPU so interactive search/rerank can run during backfill.
		select {
		case <-ctx.Done():
			return
		case <-time.After(50 * time.Millisecond):
		}
	}
}

func populateIfDue(ctx context.Context, store *local.Store, force bool) error {
	if !force {
		raw, err := store.GetState(ctx, "last_populate_unix")
		if err == nil && raw != "" {
			if ts, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
				if time.Since(time.Unix(ts, 0)) < 6*time.Hour {
					return nil
				}
			}
		}
	}
	log.Println("populating search documents from rated MusicBrainz rows…")
	n, err := store.PopulateSearchDocuments(ctx)
	if err != nil {
		return err
	}
	if err := store.SetState(ctx, "last_populate_unix", strconv.FormatInt(time.Now().Unix(), 10)); err != nil {
		log.Printf("search state: %v", err)
	}
	log.Printf("search documents inserted this pass=%d", n)
	return nil
}
