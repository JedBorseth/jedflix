FROM golang:1.24-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /backend ./cmd/backend
RUN CGO_ENABLED=0 GOOS=linux go build -o /music-indexer ./cmd/music-indexer

FROM alpine:3.20 AS indexer
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /music-indexer /app/music-indexer
ENTRYPOINT ["/app/music-indexer"]

# Default image for the `backend` service (must be the final stage).
FROM alpine:3.20
# Bun is the JS runtime yt-dlp needs for YouTube challenges (same role Deno filled).
COPY --from=oven/bun:1.3-alpine /usr/local/bin/bun /usr/local/bin/bun
RUN apk add --no-cache ca-certificates python3 py3-pip ffmpeg \
	&& pip3 install --break-system-packages --no-cache-dir -U "yt-dlp[default]" \
	&& yt-dlp --version \
	&& bun --version
WORKDIR /app
COPY --from=builder /backend /app/backend
RUN mkdir -p /data /data/music-artwork
EXPOSE 8080
ENV ADDR=:8080
ENV SPOTIFY_CATALOG_PATH=/data/spotify-catalog.json
ENV MUSIC_ARTWORK_PATH=/data/music-artwork
ENV PATH="/usr/local/bin:${PATH}"
CMD ["/app/backend"]
