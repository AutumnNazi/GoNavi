package sessionassets

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

// 只读目录连接服务于「材料库被其他实例占用」的降级列表：能读到集成与
// 资产数，不能写入，也不执行迁移（V-13 由写路径独占）。
func TestOpenCatalogReadOnlyListsIntegrations(t *testing.T) {
	root := t.TempDir()
	service, err := Open(root)
	if err != nil {
		t.Fatalf("open service: %v", err)
	}
	integration, err := service.catalog.EnableIntegration(context.Background(), AgentKindCodex, "Codex")
	if err != nil {
		t.Fatalf("enable integration: %v", err)
	}
	source, err := service.catalog.UpsertSource(context.Background(), SourceInput{
		IntegrationID: integration.ID,
		Kind:          "cli",
		DisplayName:   "default",
		RootPath:      t.TempDir(),
		IdentityKey:   "identity-readonly",
	})
	if err != nil {
		t.Fatalf("upsert source: %v", err)
	}
	seedAsset(t, service, integration.ID, source.ID, "thread-ro-1")
	catalogPath := service.catalog.Path()
	if err := service.Close(); err != nil {
		t.Fatalf("close service: %v", err)
	}

	readOnly, err := OpenCatalogReadOnly(catalogPath)
	if err != nil {
		t.Fatalf("open catalog read-only: %v", err)
	}
	defer func() { _ = readOnly.Close() }()

	integrations, err := readOnly.ListIntegrations(context.Background())
	if err != nil {
		t.Fatalf("list integrations read-only: %v", err)
	}
	if len(integrations) != 1 || integrations[0].ID != integration.ID {
		t.Fatalf("expected the seeded integration, got %+v", integrations)
	}
	count, err := readOnly.CountAssets(context.Background(), integration.ID)
	if err != nil {
		t.Fatalf("count assets read-only: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected 1 asset, got %d", count)
	}
}

// 只读连接必须拒绝写入：降级路径绝不产生新的提交。
func TestOpenCatalogReadOnlyRejectsWrites(t *testing.T) {
	root := t.TempDir()
	service, err := Open(root)
	if err != nil {
		t.Fatalf("open service: %v", err)
	}
	catalogPath := service.catalog.Path()
	if err := service.Close(); err != nil {
		t.Fatalf("close service: %v", err)
	}

	readOnly, err := OpenCatalogReadOnly(catalogPath)
	if err != nil {
		t.Fatalf("open catalog read-only: %v", err)
	}
	defer func() { _ = readOnly.Close() }()
	if _, err := readOnly.EnableIntegration(context.Background(), AgentKindCodex, "Codex"); err == nil {
		t.Fatal("write on read-only catalog must fail")
	}
}

// 目录文件不存在时不允许静默创建：降级只针对已存在的库。
func TestOpenCatalogReadOnlyRequiresExistingFile(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "catalog.sqlite")
	if _, err := OpenCatalogReadOnly(missing); err == nil {
		t.Fatal("opening a missing catalog read-only must fail")
	} else if !errors.Is(err, os.ErrNotExist) && !os.IsNotExist(err) {
		t.Logf("open returned non-NotExist error: %v", err)
	}
}
