# Local MusicBrainz for JedFlix

JedFlix serves music catalog metadata from a **local MusicBrainz Postgres replica**.
Search uses PostgreSQL full-text matching, spelling correction, and release-based
ranking. Artwork uses a lazy Cover Art Archive disk cache.

```
MusicBrainz dump/replication → Postgres (/mnt/disk1/jedflix/musicbrainz/pgdata)
                             → jedflix.search_documents + jedflix.search_terms
Cover Art Archive            → lazy cache (/mnt/disk1/jedflix/music-artwork)
                             → Go /api/v1/music/covers/...
```

Keep the existing Alpine-based Postgres image to preserve the replica’s collation.

## One-time setup (production server)

1. Ensure disk paths exist:

```bash
sudo mkdir -p /mnt/disk1/jedflix/musicbrainz/{pgdata,dumps,replication} \
  /mnt/disk1/jedflix/music-artwork
sudo chown -R "$USER:$USER" /mnt/disk1/jedflix
```

2. Set secrets in the server `.env`:

- `MUSICBRAINZ_DB_PASSWORD`
- `MBSLAVE_MUSICBRAINZ_TOKEN` (MetaBrainz live data feed token)

3. Import the official database (long-running). The `mbslave` image installs
   schema v31 from GitHub (`acoustid/mbslave`); PyPI releases may lag the dump.

```bash
./scripts/musicbrainz-import.sh
```

4. Bring up the stack (`docker compose up -d`) and confirm the backend logs
   report `local MusicBrainz Postgres (full-text search)`.

The backend builds search documents for a fresh replica and refreshes versioned
release counts and spelling terms in the background. Existing search documents
remain available during maintenance.

Run the [search benchmark](search-benchmark.md) against a populated replica with
`MUSIC_SEARCH_DSN` set. From `apps/backend`, run
`go test -count=1 -v ./internal/musicbrainz/local -run '^TestMusicSearchBenchmark$'`.

## Keep the replica current

Replication applies incremental MB changes — run it on a modest schedule (every **12 hours** is plenty):

```bash
# Cron: twice daily (00:00 and 12:00 server time)
0 0,12 * * * cd /home/jedborseth/jedflix && MBSLAVE_MUSICBRAINZ_TOKEN=... ./scripts/musicbrainz-sync.sh >>/var/log/mbslave-sync.log 2>&1
```

## Artwork

Album `imageUrl` values point at `/backend/api/v1/music/covers/release-group/{mbid}.jpg`.
The backend fetches Cover Art Archive on first request, shrinks/optimizes the image
(same approach as Open Library covers), stores it permanently under
`/mnt/disk1/jedflix/music-artwork/`, and deduplicates by content hash.
