# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage: compile a fully static Galene binary.
# CGO_ENABLED=0 produces a static binary that runs on any Linux base image.
# ---------------------------------------------------------------------------
FROM golang:1.24-alpine AS build

WORKDIR /src

# Fetch dependencies first so they are cached independently of the source.
COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags='-s -w' \
    -o /out/galene .

# ---------------------------------------------------------------------------
# Runtime stage: small, non-root, with CA certificates for outbound TLS.
# ---------------------------------------------------------------------------
FROM alpine:3.20

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S galene \
    && adduser -S -G galene -h /var/lib/galene galene

WORKDIR /var/lib/galene

COPY --from=build /out/galene /usr/local/bin/galene
COPY static ./static

# Runtime state directories (mount these as volumes to persist data).
RUN mkdir -p groups data recordings \
    && chown -R galene:galene /var/lib/galene

USER galene

# 8443  = HTTPS web server (configurable with -http)
# 1194  = built-in TURN server (configurable with -turn), TCP + UDP
EXPOSE 8443/tcp
EXPOSE 1194/tcp
EXPOSE 1194/udp

VOLUME ["/var/lib/galene/groups", "/var/lib/galene/data"]

ENTRYPOINT ["galene"]
CMD []
