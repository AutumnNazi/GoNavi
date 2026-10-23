package main

import (
	"errors"
	"os"
	"strconv"

	"GoNavi-Wails/internal/market"
)

func configuredS3() (market.ArtifactStore, error) {
	allowHTTP := false
	if raw := os.Getenv("GONAVI_MARKET_S3_ALLOW_HTTP"); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return nil, errors.New("invalid s3 allow-http setting")
		}
		allowHTTP = value
	}
	return market.NewS3Store(market.S3Options{
		Endpoint: os.Getenv("GONAVI_MARKET_S3_ENDPOINT"), Region: os.Getenv("GONAVI_MARKET_S3_REGION"),
		Bucket: os.Getenv("GONAVI_MARKET_S3_BUCKET"), Prefix: os.Getenv("GONAVI_MARKET_S3_PREFIX"),
		AccessKeyID: os.Getenv("GONAVI_MARKET_S3_ACCESS_KEY_ID"), SecretAccessKey: os.Getenv("GONAVI_MARKET_S3_SECRET_ACCESS_KEY"),
		SessionToken: os.Getenv("GONAVI_MARKET_S3_SESSION_TOKEN"), AllowHTTP: allowHTTP,
	})
}
