# Local MusicBrainz for JedFlix

JedFlix serves music catalog metadata from a **local MusicBrainz Postgres replica**
and **Meilisearch**, with a **lazy Cover Art Archive disk cache**.

```
MusicBrainz dump/replication → Postgres (/mnt/disk1/jedflix/musicbrainz/pgdata)
                             → Meilisearch (/mnt/disk1/jedflix/musicbrainz/meili)
Cover Art Archive            → lazy cache (/mnt/disk1/jedflix/music-artwork)
                             → Go /api/v1/music/covers/...
```

All MusicBrainz data, search indexes, replication packets, and artwork live under
`/mnt/disk1/jedflix/` (not the root `/` disk).

## One-time setup (production server)

1. Ensure disk paths exist:

```bash
sudo mkdir -p /mnt/disk1/jedflix/musicbrainz/{pgdata,meili,dumps,replication} \
  /mnt/disk1/jedflix/music-artwork
sudo chown -R "$USER:$USER" /mnt/disk1/jedflix
```

2. Set secrets in the server `.env`:

- `MUSICBRAINZ_DB_PASSWORD`
- `MEILI_MASTER_KEY`
- `MBSLAVE_MUSICBRAINZ_TOKEN` (MetaBrainz live data feed token)

3. Import the official database (long-running):

```bash
./scripts/musicbrainz-import.sh
```

4. Build the search index:

```bash
./scripts/musicbrainz-reindex.sh
```

5. Bring up the stack (`docker compose up -d`) and confirm backend logs show
   `local MusicBrainz + Meilisearch`.

## Keep the replica current

Replication applies incremental MB changes — run it on a modest schedule (every **12 hours** is plenty):

```bash
# Cron: twice daily (00:00 and 12:00 server time)
0 0,12 * * * cd /home/jedborseth/jedflix && MBSLAVE_MUSICBRAINZ_TOKEN=... ./scripts/musicbrainz-sync.sh >>/var/log/mbslave-sync.log 2>&1
```

After large schema changes, re-run `./scripts/musicbrainz-reindex.sh`.

## Artwork

Album `imageUrl` values point at `/backend/api/v1/music/covers/release-group/{mbid}.jpg`.
The backend fetches Cover Art Archive on first request, shrinks/optimizes the image
(same approach as Open Library covers), stores it permanently under
`/mnt/disk1/jedflix/music-artwork/`, and deduplicates by content hash.
