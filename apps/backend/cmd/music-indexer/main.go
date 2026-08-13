package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jedborseth/jeds-movies/backend/internal/config"
	"github.com/jedborseth/jeds-movies/backend/internal/musicbrainz/local"
	"github.com/jedborseth/jeds-movies/backend/internal/musicsearch"
)

func main() {
	config.LoadEnvFiles()
	batchSize := flag.Int("batch", 1000, "documents per Meilisearch batch")
	only := flag.String("only", "", "comma-separated indexes: artists,release_groups,releases,recordings (default all)")
	flag.Parse()

	dbURL := strings.TrimSpace(os.Getenv("MUSICBRAINZ_DATABASE_URL"))
	meiliURL := strings.TrimSpace(os.Getenv("MEILI_URL"))
	meiliKey := strings.TrimSpace(os.Getenv("MEILI_API_KEY"))
	if dbURL == "" || meiliURL == "" {
		log.Fatal("MUSICBRAINZ_DATABASE_URL and MEILI_URL are required")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	db, err := sql.Open("pgx", dbURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(4)

	search, err := musicsearch.New(meiliURL, meiliKey)
	if err != nil {
		log.Fatal(err)
	}
	if err := search.EnsureIndexes(ctx); err != nil {
		log.Fatal(err)
	}

	wanted := map[string]bool{}
	if strings.TrimSpace(*only) == "" {
		wanted["artists"] = true
		wanted["release_groups"] = true
		wanted["releases"] = true
		wanted["recordings"] = true
	} else {
		for _, part := range strings.Split(*only, ",") {
			wanted[strings.TrimSpace(part)] = true
		}
	}

	start := time.Now()
	if wanted["artists"] {
		if err := indexArtistArtwork(ctx, db); err != nil {
			log.Printf("warning: artist artwork URLs: %v", err)
		}
		if err := indexArtists(ctx, db, search, *batchSize); err != nil {
			log.Fatal(err)
		}
	}
	if wanted["release_groups"] {
		if err := indexReleaseGroups(ctx, db, search, *batchSize); err != nil {
			log.Fatal(err)
		}
	}
	if wanted["releases"] {
		if err := indexReleases(ctx, db, search, *batchSize); err != nil {
			log.Fatal(err)
		}
	}
	if wanted["recordings"] {
		if err := indexRecordings(ctx, db, search, *batchSize); err != nil {
			log.Fatal(err)
		}
	}
	log.Printf("music indexer finished in %s", time.Since(start).Round(time.Second))
}

func indexArtistArtwork(ctx context.Context, db *sql.DB) error {
	log.Println("storing MusicBrainz artist image URLs…")
	if err := local.EnsureArtworkSchema(ctx, db); err != nil {
		return err
	}
	res, err := db.ExecContext(ctx, `
		INSERT INTO jedflix.artwork (mbid, kind, source_url, updated_at)
		SELECT DISTINCT ON (a.gid) a.gid, 'artist', url.url, now()
		FROM musicbrainz.artist a
		JOIN musicbrainz.l_artist_url lau ON lau.entity0 = a.id
		JOIN musicbrainz.link l ON l.id = lau.link
		JOIN musicbrainz.link_type lt ON lt.id = l.link_type
		JOIN musicbrainz.url url ON url.id = lau.entity1
		WHERE lt.name = 'image' AND COALESCE(url.url, '') <> ''
		ORDER BY a.gid, lau.id DESC
		ON CONFLICT (mbid) DO UPDATE SET
			kind = EXCLUDED.kind,
			source_url = EXCLUDED.source_url,
			updated_at = now()
		WHERE jedflix.artwork.source_url IS DISTINCT FROM EXCLUDED.source_url
	`)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	log.Printf("  artist image URLs stored: %d", n)
	return nil
}

func indexArtists(ctx context.Context, db *sql.DB, search *musicsearch.Client, batch int) error {
	log.Println("indexing artists…")
	rows, err := db.QueryContext(ctx, `
		SELECT a.gid::text, a.name, COALESCE(a.sort_name, a.name),
			COALESCE((
				SELECT array_agg(DISTINCT aa.name)
				FROM musicbrainz.artist_alias aa
				WHERE aa.artist = a.id
			), '{}'),
			COALESCE(at.name, '')
		FROM musicbrainz.artist a
		LEFT JOIN musicbrainz.artist_type at ON at.id = a.type
		ORDER BY a.id
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	buf := make([]musicsearch.ArtistDoc, 0, batch)
	total := 0
	flush := func() error {
		if len(buf) == 0 {
			return nil
		}
		if err := search.IndexArtists(ctx, buf); err != nil {
			return err
		}
		total += len(buf)
		log.Printf("  artists indexed: %d", total)
		buf = buf[:0]
		return nil
	}

	for rows.Next() {
		var doc musicsearch.ArtistDoc
		var aliases rawArray
		if err := rows.Scan(&doc.ID, &doc.Name, &doc.SortName, &aliases, &doc.Type); err != nil {
			return err
		}
		doc.Aliases = []string(aliases)
		buf = append(buf, doc)
		if len(buf) >= batch {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return flush()
}

func indexReleaseGroups(ctx context.Context, db *sql.DB, search *musicsearch.Client, batch int) error {
	log.Println("indexing release groups…")
	rows, err := db.QueryContext(ctx, `
		SELECT rg.gid::text, rg.name,
			COALESCE((
				SELECT array_agg(DISTINCT rga.name)
				FROM musicbrainz.release_group_alias rga
				WHERE rga.release_group = rg.id
			), '{}'),
			COALESCE(ac.name, ''),
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = rg.artist_credit
			), '{}'),
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = rg.artist_credit
			), '{}'),
			COALESCE(rpt.name, 'Album'),
			COALESCE(
				CASE
					WHEN rgm.first_release_date_year IS NULL THEN NULL
					WHEN rgm.first_release_date_month IS NULL THEN rgm.first_release_date_year::text
					WHEN rgm.first_release_date_day IS NULL THEN
						rgm.first_release_date_year::text || '-' || lpad(rgm.first_release_date_month::text, 2, '0')
					ELSE
						rgm.first_release_date_year::text || '-' ||
						lpad(rgm.first_release_date_month::text, 2, '0') || '-' ||
						lpad(rgm.first_release_date_day::text, 2, '0')
				END,
				''
			)
		FROM musicbrainz.release_group rg
		JOIN musicbrainz.artist_credit ac ON ac.id = rg.artist_credit
		LEFT JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id
		LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
		ORDER BY rg.id
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	buf := make([]musicsearch.ReleaseGroupDoc, 0, batch)
	total := 0
	flush := func() error {
		if len(buf) == 0 {
			return nil
		}
		if err := search.IndexReleaseGroups(ctx, buf); err != nil {
			return err
		}
		total += len(buf)
		log.Printf("  release groups indexed: %d", total)
		buf = buf[:0]
		return nil
	}

	for rows.Next() {
		var doc musicsearch.ReleaseGroupDoc
		var aliases, artists, artistIDs rawArray
		if err := rows.Scan(&doc.ID, &doc.Title, &aliases, &doc.ArtistCredit, &artists, &artistIDs, &doc.PrimaryType, &doc.FirstReleaseDate); err != nil {
			return err
		}
		doc.Aliases = []string(aliases)
		doc.Artists = []string(artists)
		doc.ArtistIDs = []string(artistIDs)
		buf = append(buf, doc)
		if len(buf) >= batch {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return flush()
}

func indexReleases(ctx context.Context, db *sql.DB, search *musicsearch.Client, batch int) error {
	log.Println("indexing releases…")
	rows, err := db.QueryContext(ctx, `
		SELECT r.gid::text, r.name,
			COALESCE((
				SELECT array_agg(DISTINCT ra.name)
				FROM musicbrainz.release_alias ra
				WHERE ra.release = r.id
			), '{}'),
			COALESCE(ac.name, ''),
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = r.artist_credit
			), '{}'),
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = r.artist_credit
			), '{}'),
			rg.gid::text,
			COALESCE(rs.name, ''),
			COALESCE(`+local.ReleaseFirstDateSQL+`, '')
		FROM musicbrainz.release r
		JOIN musicbrainz.release_group rg ON rg.id = r.release_group
		JOIN musicbrainz.artist_credit ac ON ac.id = r.artist_credit
		LEFT JOIN musicbrainz.release_status rs ON rs.id = r.status
		LEFT JOIN musicbrainz.release_first_release_date rfrd ON rfrd.release = r.id
		ORDER BY r.id
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	buf := make([]musicsearch.ReleaseDoc, 0, batch)
	total := 0
	flush := func() error {
		if len(buf) == 0 {
			return nil
		}
		if err := search.IndexReleases(ctx, buf); err != nil {
			return err
		}
		total += len(buf)
		log.Printf("  releases indexed: %d", total)
		buf = buf[:0]
		return nil
	}

	for rows.Next() {
		var doc musicsearch.ReleaseDoc
		var aliases, artists, artistIDs rawArray
		if err := rows.Scan(&doc.ID, &doc.Title, &aliases, &doc.ArtistCredit, &artists, &artistIDs, &doc.ReleaseGroupID, &doc.Status, &doc.Date); err != nil {
			return err
		}
		doc.Aliases = []string(aliases)
		doc.Artists = []string(artists)
		doc.ArtistIDs = []string(artistIDs)
		buf = append(buf, doc)
		if len(buf) >= batch {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return flush()
}

func indexRecordings(ctx context.Context, db *sql.DB, search *musicsearch.Client, batch int) error {
	log.Println("indexing recordings…")
	rows, err := db.QueryContext(ctx, `
		SELECT rec.gid::text, rec.name,
			COALESCE((
				SELECT array_agg(DISTINCT ra.name)
				FROM musicbrainz.recording_alias ra
				WHERE ra.recording = rec.id
			), '{}'),
			COALESCE(ac.name, ''),
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = rec.artist_credit
			), '{}'),
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = rec.artist_credit
			), '{}'),
			COALESCE(rec.length, 0),
			COALESCE(album.album_id, ''),
			COALESCE(album.album_name, '')
		FROM musicbrainz.recording rec
		JOIN musicbrainz.artist_credit ac ON ac.id = rec.artist_credit
		LEFT JOIN LATERAL (`+local.PreferredRecordingAlbumPickSQL+`) album ON true
		ORDER BY rec.id
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	buf := make([]musicsearch.RecordingDoc, 0, batch)
	total := 0
	flush := func() error {
		if len(buf) == 0 {
			return nil
		}
		if err := search.IndexRecordings(ctx, buf); err != nil {
			return err
		}
		total += len(buf)
		log.Printf("  recordings indexed: %d", total)
		buf = buf[:0]
		return nil
	}

	for rows.Next() {
		var doc musicsearch.RecordingDoc
		var aliases, artists, artistIDs rawArray
		if err := rows.Scan(&doc.ID, &doc.Title, &aliases, &doc.ArtistCredit, &artists, &artistIDs, &doc.Length, &doc.ReleaseGroupID, &doc.AlbumName); err != nil {
			return err
		}
		doc.Aliases = []string(aliases)
		doc.Artists = []string(artists)
		doc.ArtistIDs = []string(artistIDs)
		buf = append(buf, doc)
		if len(buf) >= batch {
			if err := flush(); err != nil {
				return err
			}
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return flush()
}

// rawArray is a minimal text[] scanner for the indexer.
type rawArray []string

func (a *rawArray) Scan(src any) error {
	if src == nil {
		*a = []string{}
		return nil
	}
	var raw string
	switch v := src.(type) {
	case string:
		raw = v
	case []byte:
		raw = string(v)
	default:
		return fmt.Errorf("unsupported array type %T", src)
	}
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "{}" {
		*a = []string{}
		return nil
	}
	if len(raw) < 2 || raw[0] != '{' || raw[len(raw)-1] != '}' {
		return fmt.Errorf("invalid array: %q", raw)
	}
	inner := raw[1 : len(raw)-1]
	if inner == "" {
		*a = []string{}
		return nil
	}
	parts := strings.Split(inner, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		p = strings.Trim(p, `"`)
		if p == "" || p == "NULL" {
			continue
		}
		out = append(out, p)
	}
	*a = out
	return nil
}
