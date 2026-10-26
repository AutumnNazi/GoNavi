FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
COPY internal/market ./internal/market
COPY internal/logger ./internal/logger
COPY internal/appdata ./internal/appdata
COPY shared/i18n ./shared/i18n
COPY cmd/gonavi-market-server ./cmd/gonavi-market-server
RUN CGO_ENABLED=0 go build -trimpath -o /out/gonavi-market-server ./cmd/gonavi-market-server

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && addgroup -g 10001 market && adduser -D -H -u 10001 -G market market     && mkdir -p /data/artifacts /data/logs && chown -R market:market /data
USER 10001:10001
WORKDIR /data
COPY --from=build /out/gonavi-market-server /usr/local/bin/gonavi-market-server
ENV GONAVI_MARKET_LISTEN=0.0.0.0:8090 GONAVI_MARKET_ARTIFACT_ROOT=/data/artifacts GONAVI_LOG_DIR=/data/logs GOMEMLIMIT=384MiB
EXPOSE 8090
ENTRYPOINT ["gonavi-market-server"]
