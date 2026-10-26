package plugin

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestExporterCheckNeverStartsRuntime(t *testing.T) {
	manager := managerAt(t, t.TempDir())
	status := installExporterFixture(t, manager, "normal")
	enableFixture(t, manager, status.Manifest.ID)
	status = manager.List()[0]
	if err := manager.CheckExporterGeneration(context.Background(), status.Manifest.ID, status.Generation, "ndjson", status.Digest); !errors.Is(err, ErrDisabled) {
		t.Fatal("ownerless check", err)
	}
	if _, err := manager.InvokeExporterGeneration(context.Background(), status.Manifest.ID, status.Generation, "ndjson", status.Digest, exporterArguments("ndjson")); !errors.Is(err, ErrDisabled) {
		t.Fatal("ownerless invocation", err)
	}
	if manager.OwnsRuntime() || len(manager.instances) != 0 {
		t.Fatal("check/invoke implicitly started plugin runtime")
	}
}

func TestExporterPermissionCommandAndReservationRules(t *testing.T) {
	manifest := exporterManifest()
	if !exporterCommandReserved(manifest, "render") {
		t.Fatal("exporter command not reserved")
	}
	manifest.Permissions = nil
	if _, err := declaredExporter(manifest, "ndjson"); !errors.Is(err, ErrDisabled) {
		t.Fatal("permission ignored", err)
	}
	if !exporterCommandReserved(manifest, "render") {
		t.Fatal("permission loss unreserved generic command")
	}
	manifest = exporterManifest()
	manifest.Backend = nil
	if _, err := declaredExporter(manifest, "ndjson"); !errors.Is(err, ErrDisabled) {
		t.Fatal("backend ignored", err)
	}
	manifest = exporterManifest()
	manifest.Contributes.Commands = nil
	if _, err := declaredExporter(manifest, "ndjson"); !errors.Is(err, ErrNotFound) {
		t.Fatal("undeclared command", err)
	}
}

func TestExporterWholeArgumentBudgetIncludesEnvelope(t *testing.T) {
	valid := exporterArguments("ndjson")
	exact := append(append([]byte(nil), valid...), []byte(strings.Repeat(" ", maxExporterJSONBytes-len(valid)))...)
	if len(exact) != maxExporterJSONBytes {
		t.Fatal("fixture size")
	}
	if err := validateExporterArguments(exact, "ndjson"); err != nil {
		t.Fatal("exact bounded envelope rejected", err)
	}
	if validateExporterArguments(append(exact, ' '), "ndjson") == nil {
		t.Fatal("over-limit envelope accepted")
	}
}

func TestExporterInspectIsMetadataOnly(t *testing.T) {
	manifest := exporterManifest()
	directory := writePackage(t, manifest)
	if err := os.WriteFile(filepath.Join(directory, manifest.Backend.Default.Executable), []byte("inspection must not execute this payload"), 0600); err != nil {
		t.Fatal(err)
	}
	inspection, err := InspectPackage(context.Background(), directory)
	if err != nil {
		t.Fatal(err)
	}
	if len(inspection.Manifest.Contributes.Exporters) != 1 || inspection.Manifest.Contributes.Exporters[0] != manifest.Contributes.Exporters[0] {
		t.Fatal("exporter metadata not preserved")
	}
}
