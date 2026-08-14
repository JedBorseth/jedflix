package local

import (
	"context"
	"fmt"
	"strings"

	"github.com/jedborseth/jeds-movies/backend/internal/musiccatalog"
)

func (s *Store) PopularArtistsByTags(ctx context.Context, tags []string, limit int) ([]musiccatalog.Artist, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	tags = normalizeTagArgs(tags)
	if len(tags) == 0 {
		return nil, musiccatalog.ErrBadRequest
	}
	if limit <= 0 {
		limit = 10
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT a.gid::text,
			a.name,
			COALESCE((
				SELECT array_agg(name)
				FROM (
					SELECT t2.name
					FROM musicbrainz.artist_tag at2
					JOIN musicbrainz.tag t2 ON t2.id = at2.tag
					WHERE at2.artist = a.id
					ORDER BY at2.count DESC
					LIMIT 5
				) top_tags
			), '{}') AS genres,
			LEAST(COALESCE(am.rating_count, 0), 100)
		FROM musicbrainz.artist a
		JOIN musicbrainz.artist_tag at ON at.artist = a.id
		JOIN musicbrainz.tag t ON t.id = at.tag
		LEFT JOIN musicbrainz.artist_meta am ON am.id = a.id
		WHERE lower(t.name) = ANY($1)
		GROUP BY a.id, a.gid, a.name, am.rating_count
		ORDER BY COALESCE(am.rating_count, 0) DESC, max(at.count) DESC, a.name
		LIMIT $2
	`, pqStringArray(tags), limit)
	if err != nil {
		return nil, fmt.Errorf("%w: popular artists by tag: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()

	out := make([]musiccatalog.Artist, 0, limit)
	for rows.Next() {
		var (
			artist musiccatalog.Artist
			genres pqStringArray
		)
		if err := rows.Scan(&artist.ID, &artist.Name, &genres, &artist.Popularity); err != nil {
			return nil, fmt.Errorf("%w: scan popular artists by tag: %v", musiccatalog.ErrFetchFailed, err)
		}
		artist.Genres = []string(genres)
		out = append(out, artist)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: popular artists by tag: %v", musiccatalog.ErrFetchFailed, err)
	}
	return out, nil
}

func (s *Store) PopularReleaseGroupsByTags(ctx context.Context, tags []string, primaryType string, limit int) ([]musiccatalog.Album, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	tags = normalizeTagArgs(tags)
	if len(tags) == 0 {
		return nil, musiccatalog.ErrBadRequest
	}
	primaryType = strings.ToLower(strings.TrimSpace(primaryType))
	if primaryType == "" {
		primaryType = "album"
	}
	if limit <= 0 {
		limit = 10
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
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = rg.artist_credit
			), '{}') AS artist_ids,
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = rg.artist_credit
			), '{}') AS artist_names,
			COALESCE((
				SELECT array_agg(name)
				FROM (
					SELECT t2.name
					FROM musicbrainz.release_group_tag rgt2
					JOIN musicbrainz.tag t2 ON t2.id = rgt2.tag
					WHERE rgt2.release_group = rg.id
					ORDER BY rgt2.count DESC
					LIMIT 5
				) top_tags
			), '{}') AS genres,
			LEAST(COALESCE(rgm.rating_count, 0), 100)
		FROM musicbrainz.release_group rg
		JOIN musicbrainz.release_group_tag rgt ON rgt.release_group = rg.id
		JOIN musicbrainz.tag t ON t.id = rgt.tag
		LEFT JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id
		LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
		WHERE lower(t.name) = ANY($1)
			AND lower(COALESCE(rpt.name, 'album')) = $2
		GROUP BY rg.id, rg.gid, rg.name, rpt.name, rgm.first_release_date_year,
			rgm.first_release_date_month, rgm.first_release_date_day, rgm.rating_count
		ORDER BY COALESCE(rgm.rating_count, 0) DESC, max(rgt.count) DESC, rg.name
		LIMIT $3
	`, pqStringArray(tags), primaryType, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: popular release groups by tag: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()

	out := make([]musiccatalog.Album, 0, limit)
	for rows.Next() {
		var (
			album              musiccatalog.Album
			primary, date      string
			artistIDs, artists pqStringArray
			genres             pqStringArray
		)
		if err := rows.Scan(
			&album.ID, &album.Name, &primary, &date,
			&artistIDs, &artists, &genres, &album.Popularity,
		); err != nil {
			return nil, fmt.Errorf("%w: scan popular release groups by tag: %v", musiccatalog.ErrFetchFailed, err)
		}
		album.ArtistIDs = []string(artistIDs)
		album.Artists = []string(artists)
		album.ReleaseDate = date
		album.Year = parseYear(date)
		album.AlbumType = mapPrimaryType(primary)
		album.Genres = []string(genres)
		out = append(out, album)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: popular release groups by tag: %v", musiccatalog.ErrFetchFailed, err)
	}
	return out, nil
}

func (s *Store) PopularRecordingsByTags(ctx context.Context, tags []string, limit int) ([]musiccatalog.TopTrack, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	tags = normalizeTagArgs(tags)
	if len(tags) == 0 {
		return nil, musiccatalog.ErrBadRequest
	}
	if limit <= 0 {
		limit = 10
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT rec.gid::text,
			rec.name,
			COALESCE(NULLIF(album.length, 0), rec.length, 0),
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = rec.artist_credit
			), '{}') AS artist_names,
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = rec.artist_credit
			), '{}') AS artist_ids,
			COALESCE(album.album_id, ''),
			COALESCE(album.album_name, '')
		FROM musicbrainz.recording rec
		JOIN musicbrainz.recording_tag rt ON rt.recording = rec.id
		JOIN musicbrainz.tag t ON t.id = rt.tag
		LEFT JOIN musicbrainz.recording_meta rm ON rm.id = rec.id
		LEFT JOIN LATERAL (`+preferredRecordingAlbumSQL+`) album ON true
		WHERE lower(t.name) = ANY($1)
		GROUP BY rec.id, rec.gid, rec.name, rec.length, rm.rating_count,
			album.length, album.album_id, album.album_name
		ORDER BY COALESCE(rm.rating_count, 0) DESC, max(rt.count) DESC, rec.name
		LIMIT $2
	`, pqStringArray(tags), limit)
	if err != nil {
		return nil, fmt.Errorf("%w: popular recordings by tag: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()

	out := make([]musiccatalog.TopTrack, 0, limit)
	for rows.Next() {
		var (
			track              musiccatalog.TopTrack
			artistNames        pqStringArray
			artistIDs          pqStringArray
			albumID, albumName string
		)
		if err := rows.Scan(
			&track.ID, &track.Name, &track.DurationMs,
			&artistNames, &artistIDs, &albumID, &albumName,
		); err != nil {
			return nil, fmt.Errorf("%w: scan popular recordings by tag: %v", musiccatalog.ErrFetchFailed, err)
		}
		track.Artists = []string(artistNames)
		track.ArtistIDs = []string(artistIDs)
		track.AlbumID = albumID
		track.AlbumName = albumName
		out = append(out, track)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: popular recordings by tag: %v", musiccatalog.ErrFetchFailed, err)
	}
	return out, nil
}

func (s *Store) RecentAlbumsByYear(ctx context.Context, year, limit int) ([]musiccatalog.Album, error) {
	if !s.Configured() {
		return nil, ErrNotConfigured
	}
	if year <= 0 {
		return nil, musiccatalog.ErrBadRequest
	}
	if limit <= 0 {
		limit = 10
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
			COALESCE((
				SELECT array_agg(a.gid::text ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				JOIN musicbrainz.artist a ON a.id = acn.artist
				WHERE acn.artist_credit = rg.artist_credit
			), '{}') AS artist_ids,
			COALESCE((
				SELECT array_agg(acn.name ORDER BY acn.position)
				FROM musicbrainz.artist_credit_name acn
				WHERE acn.artist_credit = rg.artist_credit
			), '{}') AS artist_names,
			COALESCE((
				SELECT array_agg(name)
				FROM (
					SELECT t2.name
					FROM musicbrainz.release_group_tag rgt2
					JOIN musicbrainz.tag t2 ON t2.id = rgt2.tag
					WHERE rgt2.release_group = rg.id
					ORDER BY rgt2.count DESC
					LIMIT 5
				) top_tags
			), '{}') AS genres,
			LEAST(COALESCE(rgm.rating_count, 0), 100)
		FROM musicbrainz.release_group rg
		LEFT JOIN musicbrainz.release_group_meta rgm ON rgm.id = rg.id
		LEFT JOIN musicbrainz.release_group_primary_type rpt ON rpt.id = rg.type
		WHERE rgm.first_release_date_year = $1
			AND lower(COALESCE(rpt.name, 'album')) = 'album'
		ORDER BY rgm.first_release_date_month DESC NULLS LAST,
			rgm.first_release_date_day DESC NULLS LAST,
			COALESCE(rgm.rating_count, 0) DESC,
			rg.name
		LIMIT $2
	`, year, limit)
	if err != nil {
		return nil, fmt.Errorf("%w: recent albums by year: %v", musiccatalog.ErrFetchFailed, err)
	}
	defer rows.Close()

	out := make([]musiccatalog.Album, 0, limit)
	for rows.Next() {
		var (
			album              musiccatalog.Album
			primary, date      string
			artistIDs, artists pqStringArray
			genres             pqStringArray
		)
		if err := rows.Scan(
			&album.ID, &album.Name, &primary, &date,
			&artistIDs, &artists, &genres, &album.Popularity,
		); err != nil {
			return nil, fmt.Errorf("%w: scan recent albums by year: %v", musiccatalog.ErrFetchFailed, err)
		}
		album.ArtistIDs = []string(artistIDs)
		album.Artists = []string(artists)
		album.ReleaseDate = date
		album.Year = parseYear(date)
		album.AlbumType = mapPrimaryType(primary)
		album.Genres = []string(genres)
		out = append(out, album)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("%w: recent albums by year: %v", musiccatalog.ErrFetchFailed, err)
	}
	return out, nil
}

func normalizeTagArgs(tags []string) []string {
	out := make([]string, 0, len(tags))
	seen := map[string]struct{}{}
	for _, tag := range tags {
		tag = strings.ToLower(strings.TrimSpace(tag))
		if tag == "" {
			continue
		}
		if _, ok := seen[tag]; ok {
			continue
		}
		seen[tag] = struct{}{}
		out = append(out, tag)
	}
	return out
}
