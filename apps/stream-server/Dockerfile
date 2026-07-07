FROM golang:1.22-alpine AS builder
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /stream-server ./cmd/stream-server

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=builder /stream-server /app/stream-server
EXPOSE 8080
ENV ADDR=:8080
CMD ["/app/stream-server"]
