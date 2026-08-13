# Local MusicBrainz for JedFlix

JedFlix serves music catalog metadata from a **local MusicBrainz Postgres replica**.
Search uses **Postgres full-text / trigram matching plus pgvector** (Qwen3 embeddings
and a local reranker). Artwork is a **lazy Cover Art Archive disk cache**.

```
MusicBrainz dump/replication → Postgres (/mnt/disk1/jedflix/musicbrainz/pgdata)
                             → jedflix.search_documents + music_embeddings (pgvector)
Cover Art Archive            → lazy cache (/mnt/disk1/jedflix/music-artwork)
Qwen3 embed/rerank models    → /mnt/disk1/jedflix/models  (music-ai GPU service)
                             → Go /api/v1/music/covers/...
```

All MusicBrainz data, search indexes, replication packets, artwork, and model
weights live under `/mnt/disk1/jedflix/` (not the root `/` disk).

The `musicbrainz-db` image stays `postgres:16-alpine` with pgvector compiled in.
Do not switch to a Debian pgvector image — musl vs glibc collation would risk the
existing replica.

## One-time setup (production server)

1. Ensure disk paths exist:

```bash
sudo mkdir -p /mnt/disk1/jedflix/musicbrainz/{pgdata,dumps,replication} \
  /mnt/disk1/jedflix/music-artwork \
  /mnt/disk1/jedflix/models
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

4. Bring up the stack (`docker compose up -d`) and confirm backend logs show
   `local MusicBrainz Postgres (embed → pgvector → Qwen rerank)`.
   `music-ai` logs `models ready on cuda` after the first Hugging Face download.

Hybrid search reads `jedflix.search_documents` (FTS + trigram) and
`jedflix.music_embeddings` (pgvector HNSW). The `music-embed` service backfills
rated artists/albums/recordings, then calls `music-ai` on the GTX 1660 Ti
(Qwen3-Embedding-0.6B + Qwen3-Reranker-0.6B). Search works against whatever
subset is indexed so far; vectors fill in over the following hours.

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
