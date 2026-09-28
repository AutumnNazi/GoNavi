package app

import (
	"strings"
	"testing"

	"GoNavi-Wails/internal/connection"
	"GoNavi-Wails/internal/db"
)

func TestPulsarRegistrationAndMetadata(t *testing.T) {
	for _, kind := range []string{"pulsar", "apache-pulsar", "apache_pulsar"} {
		t.Run(kind, func(t *testing.T) {
			definition, ok := resolveDriverDefinitionWithPackages(kind, nil)
			if !ok || !definition.BuiltIn {
				t.Fatal("missing built-in driver")
			}
			inst, err := db.NewDatabase(kind)
			if err != nil {
				t.Fatal(err)
			}
			if _, ok := inst.(*db.PulsarDB); !ok {
				t.Fatalf("wrong driver: %T", inst)
			}
			cfg := connection.ConnectionConfig{Type: kind, Database: "persistent://public/default/orders.events"}
			if normalizeRunConfig(cfg, "topics").Database != cfg.Database {
				t.Fatal("synthetic database replaced topic")
			}
			schema, topic := normalizeMetadataSchemaAndTable(cfg, "topics", cfg.Database)
			if schema != "topics" || topic != cfg.Database {
				t.Fatal("topic was split as schema.table")
			}
		})
	}
	if tableObjectTypeForDB("pulsar") != "topic" || !databaseObjectIdentifiersAreCaseSensitive("pulsar") {
		t.Fatal("topic metadata contract")
	}
	if _, ok := connectionExcelTypeSet["pulsar"]; !ok {
		t.Fatal("missing excel import type")
	}
}

func TestPulsarCommandsRespectReadOnlyAndSecretBoundaries(t *testing.T) {
	if !isReadOnlySQLQuery("pulsar", `CONSUME FROM "persistent://public/default/orders" EARLIEST LIMIT 10`) {
		t.Fatal("preview must be read-only")
	}
	if isReadOnlySQLQuery("pulsar", `{"publish":"orders","value":"test"}`) {
		t.Fatal("publish must be classified as a write")
	}
	public, sensitive := partitionConnectionParams("token=secret&authToken=other&startOffset=earliest")
	if strings.Contains(public, "secret") || strings.Contains(public, "other") || sensitive == "" {
		t.Fatal("Pulsar tokens must use the existing secret store")
	}
}
