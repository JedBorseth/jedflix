FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /stream-server ./cmd/stream-server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates curl python3 py3-pip ffmpeg \
	&& pip3 install --break-system-packages --no-cache-dir -U "yt-dlp[default]" \
	&& curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
	&& yt-dlp --version \
	&& deno --version
WORKDIR /app
COPY --from=builder /stream-server /app/stream-server
EXPOSE 8080
ENV ADDR=:8080
ENV PATH="/usr/local/bin:${PATH}"
CMD ["/app/stream-server"]
