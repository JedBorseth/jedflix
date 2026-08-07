FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /backend ./cmd/backend

FROM alpine:3.20
# Bun is the JS runtime yt-dlp needs for YouTube challenges (same role Deno filled).
COPY --from=oven/bun:1.3-alpine /usr/local/bin/bun /usr/local/bin/bun
RUN apk add --no-cache ca-certificates python3 py3-pip ffmpeg \
	&& pip3 install --break-system-packages --no-cache-dir -U "yt-dlp[default]" \
	&& yt-dlp --version \
	&& bun --version
WORKDIR /app
COPY --from=builder /backend /app/backend
RUN mkdir -p /data
EXPOSE 8080
ENV ADDR=:8080
ENV SPOTIFY_CATALOG_PATH=/data/spotify-catalog.json
ENV PATH="/usr/local/bin:${PATH}"
CMD ["/app/backend"]
