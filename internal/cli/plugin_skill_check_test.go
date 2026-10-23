package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"
)

func TestPluginCheckExampleSkillPackage(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	packagePath := filepath.Join("..", "..", "examples", "plugins", "skills")
	var stdout, stderr bytes.Buffer
	if code := runPlugin(ctx, []string{"--root", t.TempDir(), "check", packagePath}, &stdout, &stderr); code != ExitSuccess {
		t.Fatalf("exit=%d stderr=%s", code, stderr.String())
	}
	var result struct {
		Valid      bool `json:"valid"`
		Inspection struct {
			Manifest struct {
				ID          string `json:"id"`
				Contributes struct {
					Skills []struct {
						Resources []string `json:"resources"`
					} `json:"skills"`
				} `json:"contributes"`
			} `json:"manifest"`
		} `json:"inspection"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if !result.Valid || result.Inspection.Manifest.ID != "sdk.examples.skills" || len(result.Inspection.Manifest.Contributes.Skills) != 1 || result.Inspection.Manifest.Contributes.Skills[0].Resources[0] != "skills/read-only-investigation/REFERENCE.md" {
		t.Fatalf("check result: %s", stdout.String())
	}
}
