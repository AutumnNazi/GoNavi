package main

import "testing"

func TestConfiguredS3UsesExplicitConfiguration(t *testing.T) {
	t.Setenv("GONAVI_MARKET_ARTIFACT_STORE", "s3")
	for key, value := range map[string]string{
		"GONAVI_MARKET_S3_ENDPOINT": "https://s3.example.test", "GONAVI_MARKET_S3_REGION": "us-east-1",
		"GONAVI_MARKET_S3_BUCKET": "test-artifacts", "GONAVI_MARKET_S3_ACCESS_KEY_ID": "TESTKEY",
		"GONAVI_MARKET_S3_SECRET_ACCESS_KEY": "synthetic-test-secret", "GONAVI_MARKET_S3_SESSION_TOKEN": "",
		"GONAVI_MARKET_S3_PREFIX": "plugins", "GONAVI_MARKET_S3_ALLOW_HTTP": "false",
	} {
		t.Setenv(key, value)
	}
	if _, err := configuredArtifacts(); err != nil {
		t.Fatal(err)
	}
	t.Setenv("GONAVI_MARKET_S3_ALLOW_HTTP", "invalid")
	if _, err := configuredArtifacts(); err == nil {
		t.Fatal("invalid security setting accepted")
	}
	t.Setenv("GONAVI_MARKET_S3_ALLOW_HTTP", "false")
	t.Setenv("GONAVI_MARKET_S3_SECRET_ACCESS_KEY", "")
	if _, err := configuredArtifacts(); err == nil {
		t.Fatal("missing credentials accepted")
	}
}
