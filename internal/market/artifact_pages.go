package market

import (
	"fmt"
	"strings"
	"unicode/utf8"
)

// Marketplace artifact validation mirrors the host page contract so a package
// that installs locally can also be published. Html pages are accepted because
// the pages contract allows them behind ui.html-panel; html panels stay rejected
// by this validator, a pre-existing gap outside the page contract.
const (
	artifactPagesPermission       = "ui.pages"
	artifactCustomPanelPermission = "ui.html-panel"
	artifactPageLocationTools     = "tools"
	artifactMaxPages              = 32
	artifactMaxNavigation         = 32
	artifactMinNavigationOrder    = -1000
	artifactMaxNavigationOrder    = 1000
)

func validateArtifactPages(manifest artifactManifest, commands map[string]bool) error {
	pages := manifest.Contributes.Pages
	navigation := manifest.Contributes.Navigation
	if len(pages) == 0 && len(navigation) == 0 {
		return nil
	}
	permissions := make(map[string]bool, len(manifest.Permissions))
	for _, permission := range manifest.Permissions {
		permissions[permission] = true
	}
	if !permissions[artifactPagesPermission] {
		return fmt.Errorf("pages or navigation require the %s permission", artifactPagesPermission)
	}
	if len(pages) > artifactMaxPages || len(navigation) > artifactMaxNavigation {
		return fmt.Errorf("too many pages or navigation entries")
	}
	declared, err := validateArtifactPageDeclarations(pages, permissions, commands)
	if err != nil {
		return err
	}
	return validateArtifactNavigationDeclarations(navigation, declared)
}

// validateArtifactPageDeclarations returns the declared page ids for navigation
// resolution. The node budget is cumulative across pages, like host panels.
func validateArtifactPageDeclarations(pages []artifactPage, permissions, commands map[string]bool) (map[string]bool, error) {
	declared := make(map[string]bool, len(pages))
	nodes := 0
	for _, page := range pages {
		if !artifactLocalIDPattern.MatchString(page.ID) || declared[page.ID] || !artifactText(page.Title, 256) {
			return nil, fmt.Errorf("invalid or duplicate page")
		}
		declared[page.ID] = true
		switch {
		case page.Body != nil && page.HTML != nil:
			return nil, fmt.Errorf("page declares both a declarative body and custom html")
		case page.HTML != nil:
			if !permissions[artifactCustomPanelPermission] {
				return nil, fmt.Errorf("custom html page requires the %s permission", artifactCustomPanelPermission)
			}
			if err := validateArtifactPageHTML(*page.HTML); err != nil {
				return nil, err
			}
		case page.Body != nil:
			if err := validateArtifactNode(*page.Body, commands, 0, &nodes); err != nil {
				return nil, err
			}
		default:
			return nil, fmt.Errorf("page declares no body")
		}
	}
	return declared, nil
}

// validateArtifactPageHTML mirrors the host bounded UTF-8 rule so a page can
// never turn valid only after installation.
func validateArtifactPageHTML(panel artifactHTMLPanel) error {
	if strings.TrimSpace(panel.Source) == "" {
		return fmt.Errorf("custom html page is empty")
	}
	if len(panel.Source) > 256<<10 {
		return fmt.Errorf("custom html page exceeds size limit")
	}
	if !utf8.ValidString(panel.Source) || strings.ContainsRune(panel.Source, 0) {
		return fmt.Errorf("custom html page is not valid text")
	}
	return nil
}

func validateArtifactNavigationDeclarations(navigation []artifactNavigation, pages map[string]bool) error {
	declared := make(map[string]bool, len(navigation))
	for _, item := range navigation {
		if !artifactLocalIDPattern.MatchString(item.ID) || declared[item.ID] || !artifactText(item.Title, 256) {
			return fmt.Errorf("invalid or duplicate navigation entry")
		}
		declared[item.ID] = true
		if !pages[item.Page] {
			return fmt.Errorf("navigation references an undeclared page")
		}
		if item.Location != artifactPageLocationTools {
			return fmt.Errorf("unsupported navigation location")
		}
		if item.Order < artifactMinNavigationOrder || item.Order > artifactMaxNavigationOrder {
			return fmt.Errorf("navigation order exceeds limit")
		}
	}
	return nil
}
