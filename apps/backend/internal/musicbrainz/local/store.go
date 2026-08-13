// Package local queries a MusicBrainz Postgres replica (mbslave) for catalog detail.
package local

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

var (
	ErrNotConfigured = errors.New("local musicbrainz database is not configured")
)

// preferredRecordingAlbumSQL picks a studio album over singles/bootlegs so
// tracks like Karma Police get OK Computer cover art instead of a cover-less single.
const preferredRecordingAlbumSQL = `
	SELECT rg.gid::text AS album_id, rg.name AS album_name,
		COALESCE(NULLIF(t.length, 0), NULLIF(rec.length, 0), 0) AS length
	FROM musicbrainz.track t
	JOIN musicbrainz.medium m ON m.id = t.medium
	JOIN musicbrainz.release r ON r.id = m.release
	JOIN musicbrainz.release_group rg ON rg.id = r.release_group
	LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
	LEFT JOIN musicbrainz.release_status rs ON rs.id = r.status
	LEFT JOIN musicbrainz.release_first_release_date rfrd ON rfrd.release = r.id
	WHERE t.recording = rec.id
	ORDER BY
		CASE lower(COALESCE(rpt.name, ''))
			WHEN 'album' THEN 0
			WHEN 'ep' THEN 1
			WHEN 'single' THEN 2
			ELSE 3
		END,
		CASE WHEN lower(COALESCE(rs.name, '')) = 'official' THEN 0 ELSE 1 END,
		CASE COALESCE((
			SELECT rc.country
			FROM musicbrainz.release_country rc
			WHERE rc.release = r.id
			ORDER BY CASE rc.country WHEN 222 THEN 0 WHEN 221 THEN 1 ELSE 2 END
			LIMIT 1
		), 0) WHEN 222 THEN 0 WHEN 221 THEN 1 ELSE 2 END,
		rfrd.year NULLS LAST,
		r.id
	LIMIT 1
`

// PreferredRecordingAlbumPickSQL selects album id/name for indexer recording docs.
const PreferredRecordingAlbumPickSQL = `
	SELECT rg.gid::text AS album_id, rg.name AS album_name
	FROM musicbrainz.track t
	JOIN musicbrainz.medium m ON m.id = t.medium
	JOIN musicbrainz.release r ON r.id = m.release
	JOIN musicbrainz.release_group rg ON rg.id = r.release_group
	LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
	LEFT JOIN musicbrainz.release_status rs ON rs.id = r.status
	LEFT JOIN musicbrainz.release_first_release_date rfrd ON rfrd.release = r.id
	WHERE t.recording = rec.id
	ORDER BY
		CASE lower(COALESCE(rpt.name, ''))
			WHEN 'album' THEN 0
			WHEN 'ep' THEN 1
			WHEN 'single' THEN 2
			ELSE 3
		END,
		CASE WHEN lower(COALESCE(rs.name, '')) = 'official' THEN 0 ELSE 1 END,
		CASE COALESCE((
			SELECT rc.country
			FROM musicbrainz.release_country rc
			WHERE rc.release = r.id
			ORDER BY CASE rc.country WHEN 222 THEN 0 WHEN 221 THEN 1 ELSE 2 END
			LIMIT 1
		), 0) WHEN 222 THEN 0 WHEN 221 THEN 1 ELSE 2 END,
		rfrd.year NULLS LAST,
		r.id
	LIMIT 1
`

const releaseFirstDateSQL = `
	CASE
		WHEN rfrd.year IS NULL THEN NULL
		WHEN rfrd.month IS NULL THEN rfrd.year::text
		WHEN rfrd.day IS NULL THEN rfrd.year::text || '-' || lpad(rfrd.month::text, 2, '0')
		ELSE rfrd.year::text || '-' || lpad(rfrd.month::text, 2, '0') || '-' || lpad(rfrd.day::text, 2, '0')
	END
`

// ReleaseFirstDateSQL formats release_first_release_date as YYYY-MM-DD text.
const ReleaseFirstDateSQL = releaseFirstDateSQL

// Store reads entity details from a local MusicBrainz PostgreSQL replica.
type Store struct {
	db *sql.DB
}

func Open(databaseURL string) (*Store, error) {
	databaseURL = strings.TrimSpace(databaseURL)
	if databaseURL == "" {
		return nil, ErrNotConfigured
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("open musicbrainz db: %w", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("ping musicbrainz db: %w", err)
	}
	// Require a populated MusicBrainz schema before enabling local mode.
	var ok bool
	if err := db.QueryRowContext(ctx, `
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'musicbrainz' AND table_name = 'artist'
		)
	`).Scan(&ok); err != nil || !ok {
		_ = db.Close()
		if err != nil {
			return nil, fmt.Errorf("check musicbrainz schema: %w", err)
		}
		return nil, fmt.Errorf("%w: musicbrainz schema missing — run scripts/musicbrainz-import.sh", ErrNotConfigured)
	}
	store := &Store{db: db}
	schemaCtx, schemaCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer schemaCancel()
	if err := EnsureArtworkSchema(schemaCtx, db); err != nil {
		fmt.Printf("jedflix artwork schema unavailable: %v\n", err)
	}
	return store, nil
}

func (s *Store) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *Store) Configured() bool {
	return s != nil && s.db != nil
}

func (s *Store) GetArtist(ctx context.Context, artistGID string) (*musiccatalog.ArtistDetails, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	artistGID = strings.ToLower(strings.TrimSpace(artistGID))
	if artistGID == "" {
		return nil, musiccatalog.ErrBadRequest
	}

	var (
		name   string
		genres pqStringArray
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT a.name,
			COALESCE((
				SELECT array_agg(name)
				FROM (
					SELECT t.name
					FROM musicbrainz.artist_tag at
					JOIN musicbrainz.tag t ON t.id = at.tag
					WHERE at.artist = a.id
					ORDER BY at.count DESC
					LIMIT 5
				) top_tags
			), '{}') AS genres
		FROM musicbrainz.artist a
		WHERE a.gid = $1::uuid
	`, artistGID).Scan(&name, &genres)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, musiccatalog.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: artist: %v", musiccatalog.ErrFetchFailed, err)
	}

	groups, err := s.listArtistReleaseGroups(ctx, artistGID, 50)
	if err != nil {
		return nil, err
	}

	albums := make([]musiccatalog.Album, 0)
	discography := make([]musiccatalog.Album, 0, len(groups))
	for _, g := range groups {
		discography = append(discography, g)
		if strings.EqualFold(g.AlbumType, "album") && !looksLiveOrBootleg(g.Name) {
			albums = append(albums, g)
		}
	}

	return &musiccatalog.ArtistDetails{
		Artist: musiccatalog.Artist{
			ID:       artistGID,
			Name:     name,
			ImageURL: "", // filled by caller (Wikimedia / album-cover proxy)
			Genres:   []string(genres),
		},
		Albums:      albums,
		Discography: discography,
		TopTracks:   nil, // filled by caller via Last.fm / search
	}, nil
}

func (s *Store) listArtistReleaseGroups(ctx context.Context, artistGID string, limit int) ([]musiccatalog.Album, error) {
	if limit <= 0 {
		limit = 25
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT rg.gid::text,
			rg.name,
			COALESCE(rpt.name, 'Album') AS primary_type,
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
			) AS first_release_date,
			COALESCE(ac.name, '') AS artist_credit,
			COALESCE((
				SELECT array_agg(a2.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a2 ON a2.id = acn.artist
				WHERE acn.artist_credit = rg.artist_credit
			), '{}') AS artist_ids,
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = rg.artist_credit
			), '{}') AS artist_names
		FROM musicbrainz.release_group rg
		JOIN musicbrainz.artist_credit ac ON ac.id = rg.artist_credit
		JOIN musicbrainz.artist_credit_name acn0 ON acn0.artist_credit = rg.artist_credit AND acn0.position = 0
		JOIN musicbrainz.artist a ON a.id = acn0.artist
		LEFT JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id
		LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
		WHERE a.gid = $1::uuid
		ORDER BY rgm.first_release_date_year DESC NULLS LAST,
			rgm.first_release_date_month DESC NULLS LAST,
			rgm.first_release_date_day DESC NULLS LAST,
			rg.name
		LIMIT $2
	`, artistGID, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: release groups: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()

	out := make([]musiccatalog.Album, 0, limit)
	for rows.Next() {
		var (
			gid, title, primaryType, date, _credit string
			artistIDs, artistNames                 pqStringArray
		)
		if err := rows.Scan(&gid, &title, &primaryType, &date, &_credit, &artistIDs, &artistNames); err != nil {
			return nil, fmt.Errorf("%w: scan release group: %v", musiccatalog.ErrFetchFailed, err)
		}
		year := parseYear(date)
		out = append(out, musiccatalog.Album{
			ID:          gid,
			Name:        title,
			Artists:     []string(artistNames),
			ArtistIDs:   []string(artistIDs),
			ReleaseDate: date,
			Year:        year,
			AlbumType:   mapPrimaryType(primaryType),
			Genres:      []string{},
		})
	}
	return out, rows.Err()
}

func (s *Store) GetReleaseGroupAlbum(ctx context.Context, releaseGroupGID string, withTracks bool) (*musiccatalog.Album, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	releaseGroupGID = strings.ToLower(strings.TrimSpace(releaseGroupGID))
	if releaseGroupGID == "" {
		return nil, musiccatalog.ErrBadRequest
	}

	var (
		title, primaryType, date string
		artistIDs, artistNames   pqStringArray
		genres                   pqStringArray
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT rg.name,
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
			),
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = rg.artist_credit
			), '{}'),
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = rg.artist_credit
			), '{}'),
			COALESCE((
				SELECT array_agg(name)
				FROM (
					SELECT t.name
					FROM musicbrainz.release_group_tag rgt
					JOIN musicbrainz.tag t ON t.id = rgt.tag
					WHERE rgt.release_group = rg.id
					ORDER BY rgt.count DESC
					LIMIT 5
				) top_tags
			), '{}')
		FROM musicbrainz.release_group rg
		LEFT JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id
		LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
		WHERE rg.gid = $1::uuid
	`, releaseGroupGID).Scan(&title, &primaryType, &date, &artistIDs, &artistNames, &genres)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, musiccatalog.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: release group: %v", musiccatalog.ErrFetchFailed, err)
	}

	album := musiccatalog.Album{
		ID:          releaseGroupGID,
		Name:        title,
		Artists:     []string(artistNames),
		ArtistIDs:   []string(artistIDs),
		ReleaseDate: date,
		Year:        parseYear(date),
		AlbumType:   mapPrimaryType(primaryType),
		Genres:      []string(genres),
	}

	if !withTracks {
		return &album, nil
	}

	releaseGID, err := s.pickOfficialRelease(ctx, releaseGroupGID)
	if err != nil {
		return &album, nil
	}
	tracks, label, releaseDate, err := s.fetchReleaseTracks(ctx, releaseGID)
	if err != nil {
		return &album, nil
	}
	album.Tracks = tracks
	album.TotalTracks = len(tracks)
	if label != "" {
		album.Label = label
	}
	if releaseDate != "" {
		album.ReleaseDate = releaseDate
		album.Year = parseYear(releaseDate)
	}
	return &album, nil
}

func (s *Store) pickOfficialRelease(ctx context.Context, releaseGroupGID string) (string, error) {
	var gid string
	err := s.db.QueryRowContext(ctx, `
		SELECT r.gid::text
		FROM musicbrainz.release r
		JOIN musicbrainz.release_group rg ON rg.id = r.release_group
		LEFT JOIN musicbrainz.release_status rs ON rs.id = r.status
		LEFT JOIN musicbrainz.release_first_release_date rfrd ON rfrd.release = r.id
		WHERE rg.gid = $1::uuid
		ORDER BY
			CASE WHEN lower(COALESCE(rs.name, '')) = 'official' THEN 0 ELSE 1 END,
			CASE COALESCE((
				SELECT rc.country
				FROM musicbrainz.release_country rc
				WHERE rc.release = r.id
				ORDER BY CASE rc.country WHEN 222 THEN 0 WHEN 221 THEN 1 ELSE 2 END
				LIMIT 1
			), 0) WHEN 222 /* US */ THEN 0 WHEN 221 /* GB */ THEN 1 ELSE 2 END,
			rfrd.year NULLS LAST,
			rfrd.month NULLS LAST,
			rfrd.day NULLS LAST,
			r.id
		LIMIT 1
	`, releaseGroupGID).Scan(&gid)
	if errors.Is(err, sql.ErrNoRows) {
		return "", musiccatalog.ErrNotFound
	}
	if err != nil {
		return "", fmt.Errorf("%w: pick release: %v", musiccatalog.ErrFetchFailed, err)
	}
	return gid, nil
}

func (s *Store) fetchReleaseTracks(ctx context.Context, releaseGID string) ([]musiccatalog.Track, string, string, error) {
	var (
		label string
		date  string
	)
	_ = s.db.QueryRowContext(ctx, `
		SELECT COALESCE((
			SELECT l.name
			FROM musicbrainz.release_label rl
			JOIN musicbrainz.label l ON l.id = rl.label
			WHERE rl.release = r.id
			ORDER BY rl.catalog_number NULLS LAST
			LIMIT 1
		), ''),
		COALESCE(`+releaseFirstDateSQL+`, '')
		FROM musicbrainz.release r
		LEFT JOIN musicbrainz.release_first_release_date rfrd ON rfrd.release = r.id
		WHERE r.gid = $1::uuid
	`, releaseGID).Scan(&label, &date)

	rows, err := s.db.QueryContext(ctx, `
		SELECT COALESCE(rec.gid::text, t.gid::text),
			COALESCE(NULLIF(t.name, ''), rec.name),
			COALESCE(t.length, rec.length, 0),
			COALESCE(m.position, 1),
			COALESCE(NULLIF(t.number, ''), t.position::text),
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = COALESCE(t.artist_credit, rec.artist_credit)
			), '{}'),
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = COALESCE(t.artist_credit, rec.artist_credit)
			), '{}')
		FROM musicbrainz.release r
		JOIN musicbrainz.medium m ON m.release = r.id
		JOIN musicbrainz.track t ON t.medium = m.id
		LEFT JOIN musicbrainz.recording rec ON rec.id = t.recording
		WHERE r.gid = $1::uuid
		ORDER BY m.position, t.position
	`, releaseGID)
	if err != nil {
		return nil, "", "", fmt.Errorf("%w: tracks: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()

	tracks := make([]musiccatalog.Track, 0)
	for rows.Next() {
		var (
			id, name, number       string
			length, disc           int
			artistNames, artistIDs pqStringArray
		)
		if err := rows.Scan(&id, &name, &length, &disc, &number, &artistNames, &artistIDs); err != nil {
			return nil, "", "", fmt.Errorf("%w: scan track: %v", musiccatalog.ErrFetchFailed, err)
		}
		trackNum := len(tracks) + 1
		if n, err := parsePositiveInt(number); err == nil {
			trackNum = n
		}
		tracks = append(tracks, musiccatalog.Track{
			ID:          id,
			Name:        name,
			Artists:     []string(artistNames),
			ArtistIDs:   []string(artistIDs),
			TrackNumber: trackNum,
			DiscNumber:  disc,
			DurationMs:  length,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, "", "", err
	}
	return tracks, label, date, nil
}

func (s *Store) ResolveArtistByName(ctx context.Context, name string) (*musiccatalog.Artist, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	var gid, resolved string
	err := s.db.QueryRowContext(ctx, `
		SELECT a.gid::text, a.name
		FROM musicbrainz.artist a
		WHERE lower(a.name) = lower($1)
		ORDER BY a.id
		LIMIT 1
	`, name).Scan(&gid, &resolved)
	if errors.Is(err, sql.ErrNoRows) {
		err = s.db.QueryRowContext(ctx, `
			SELECT a.gid::text, a.name
			FROM musicbrainz.artist_alias aa
			JOIN musicbrainz.artist a ON a.id = aa.artist
			WHERE lower(aa.name) = lower($1)
			ORDER BY a.id
			LIMIT 1
		`, name).Scan(&gid, &resolved)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, musiccatalog.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: resolve artist: %v", musiccatalog.ErrFetchFailed, err)
	}
	return &musiccatalog.Artist{ID: gid, Name: resolved, Genres: []string{}}, nil
}

func (s *Store) ResolveReleaseGroupByName(ctx context.Context, name, artist string) (*musiccatalog.Album, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	var gid string
	var err error
	if artist != "" {
		err = s.db.QueryRowContext(ctx, `
			SELECT rg.gid::text
			FROM musicbrainz.release_group rg
			JOIN musicbrainz.artist_credit_name acn ON acn.artist_credit = rg.artist_credit AND acn.position = 0
			JOIN musicbrainz.artist a ON a.id = acn.artist
			WHERE lower(rg.name) = lower($1) AND lower(a.name) = lower($2)
			ORDER BY rg.id
			LIMIT 1
		`, name, artist).Scan(&gid)
	} else {
		err = s.db.QueryRowContext(ctx, `
			SELECT rg.gid::text
			FROM musicbrainz.release_group rg
			WHERE lower(rg.name) = lower($1)
			ORDER BY rg.id
			LIMIT 1
		`, name).Scan(&gid)
	}
	if errors.Is(err, sql.ErrNoRows) {
		return nil, musiccatalog.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: resolve album: %v", musiccatalog.ErrFetchFailed, err)
	}
	return s.GetReleaseGroupAlbum(ctx, gid, true)
}

func (s *Store) GetRecording(ctx context.Context, recordingGID string) (*musiccatalog.TopTrack, error) {
	recordingGID = strings.ToLower(strings.TrimSpace(recordingGID))
	if recordingGID == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	var (
		title                  string
		length                 int
		artistNames, artistIDs pqStringArray
		albumID, albumName     sql.NullString
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT rec.name,
			COALESCE(NULLIF(album.length, 0), rec.length, 0),
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
			album.album_id,
			album.album_name
		FROM musicbrainz.recording rec
		LEFT JOIN LATERAL (`+preferredRecordingAlbumSQL+`) album ON true
		WHERE rec.gid = $1::uuid
	`, recordingGID).Scan(&title, &length, &artistNames, &artistIDs, &albumID, &albumName)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, musiccatalog.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: recording: %v", musiccatalog.ErrFetchFailed, err)
	}
	track := &musiccatalog.TopTrack{
		ID:         recordingGID,
		Name:       title,
		Artists:    []string(artistNames),
		ArtistIDs:  []string(artistIDs),
		DurationMs: length,
	}
	if albumID.Valid {
		track.AlbumID = albumID.String
	}
	if albumName.Valid {
		track.AlbumName = albumName.String
	}
	return track, nil
}

// ResolveRecordingByName finds a recording by exact title + primary artist, preferring
// versions that appear on a studio album.
func (s *Store) ResolveRecordingByName(ctx context.Context, name, artist string) (*musiccatalog.TopTrack, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	name = strings.TrimSpace(name)
	artist = strings.TrimSpace(artist)
	if name == "" || artist == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	var gid string
	err := s.db.QueryRowContext(ctx, `
		SELECT rec.gid::text
		FROM musicbrainz.recording rec
		JOIN musicbrainz.artist_credit_name acn
			ON acn.artist_credit = rec.artist_credit AND acn.position = 0
		JOIN musicbrainz.artist a ON a.id = acn.artist
		WHERE lower(rec.name) = lower($1) AND lower(a.name) = lower($2)
		ORDER BY (
			SELECT CASE lower(COALESCE(rpt.name, ''))
				WHEN 'album' THEN 0
				WHEN 'ep' THEN 1
				WHEN 'single' THEN 2
				ELSE 3
			END
			FROM musicbrainz.track t
			JOIN musicbrainz.medium m ON m.id = t.medium
			JOIN musicbrainz.release r ON r.id = m.release
			JOIN musicbrainz.release_group rg ON rg.id = r.release_group
			LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
			WHERE t.recording = rec.id
			ORDER BY CASE lower(COALESCE(rpt.name, ''))
				WHEN 'album' THEN 0
				WHEN 'ep' THEN 1
				WHEN 'single' THEN 2
				ELSE 3
			END
			LIMIT 1
		) NULLS LAST,
		rec.length DESC NULLS LAST,
		rec.id
		LIMIT 1
	`, name, artist).Scan(&gid)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, musiccatalog.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: resolve recording: %v", musiccatalog.ErrFetchFailed, err)
	}
	return s.GetRecording(ctx, gid)
}

// ResolveRecordingForArtist finds a recording by title for a known artist MBID.
// Starting from artist.gid avoids a full-table lower(name) scan.
func (s *Store) ResolveRecordingForArtist(ctx context.Context, artistGID, name string) (*musiccatalog.TopTrack, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	artistGID = strings.ToLower(strings.TrimSpace(artistGID))
	name = strings.TrimSpace(name)
	if artistGID == "" || name == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	var gid string
	err := s.db.QueryRowContext(ctx, `
		SELECT rec.gid::text
		FROM musicbrainz.artist a
		JOIN musicbrainz.artist_credit_name acn
			ON acn.artist = a.id AND acn.position = 0
		JOIN musicbrainz.recording rec ON rec.artist_credit = acn.artist_credit
		WHERE a.gid = $1::uuid AND rec.name = $2
		ORDER BY rec.length DESC NULLS LAST, rec.id
		LIMIT 1
	`, artistGID, name).Scan(&gid)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, musiccatalog.ErrNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("%w: resolve recording for artist: %v", musiccatalog.ErrFetchFailed, err)
	}
	return s.GetRecording(ctx, gid)
}

// ArtistImageURL returns a MusicBrainz "image" URL relationship (usually Wikimedia).
func (s *Store) ArtistImageURL(ctx context.Context, artistGID string) (string, error) {
	if !s.Configured() {
		return "", ErrNotConfigured
	}
	artistGID = strings.ToLower(strings.TrimSpace(artistGID))
	if artistGID == "" {
		return "", musiccatalog.ErrBadRequest
	}
	var raw sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT url.url
		FROM musicbrainz.artist a
		JOIN musicbrainz.l_artist_url lau ON lau.entity0 = a.id
		JOIN musicbrainz.link l ON l.id = lau.link
		JOIN musicbrainz.link_type lt ON lt.id = l.link_type
		JOIN musicbrainz.url url ON url.id = lau.entity1
		WHERE a.gid = $1::uuid AND lt.name = 'image'
		ORDER BY lau.id DESC, url.id
		LIMIT 1
	`, artistGID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("%w: artist image url: %v", musiccatalog.ErrFetchFailed, err)
	}
	if !raw.Valid {
		return "", nil
	}
	return strings.TrimSpace(raw.String), nil
}

// PreferredArtistAlbums returns studio-album release-group IDs for an artist,
// newest first — used as artist-image fallback when Wikimedia is missing.
func (s *Store) PreferredArtistAlbums(ctx context.Context, artistGID string, limit int) ([]string, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	artistGID = strings.ToLower(strings.TrimSpace(artistGID))
	if artistGID == "" {
		return nil, musiccatalog.ErrBadRequest
	}
	if limit <= 0 {
		limit = 5
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT rg.gid::text
		FROM musicbrainz.release_group rg
		JOIN musicbrainz.artist_credit_name acn
			ON acn.artist_credit = rg.artist_credit AND acn.position = 0
		JOIN musicbrainz.artist a ON a.id = acn.artist
		LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
		LEFT JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id
		WHERE a.gid = $1::uuid
			AND lower(COALESCE(rpt.name, 'Album')) = 'album'
		ORDER BY rgm.first_release_date_year DESC NULLS LAST,
			rgm.first_release_date_month DESC NULLS LAST,
			rgm.first_release_date_day DESC NULLS LAST,
			rg.id
		LIMIT $2
	`, artistGID, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: preferred artist albums: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()

	out := make([]string, 0, limit)
	for rows.Next() {
		var gid string
		if err := rows.Scan(&gid); err != nil {
			return nil, fmt.Errorf("%w: scan preferred album: %v", musiccatalog.ErrFetchFailed, err)
		}
		if gid != "" {
			out = append(out, gid)
		}
	}
	return out, rows.Err()
}
