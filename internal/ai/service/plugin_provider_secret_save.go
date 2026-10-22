package aiservice

import (
	"errors"
	"strings"

	"GoNavi-Wails/internal/ai"
)

// resolveProviderSaveRuntimeLocked keeps legacy merge behavior isolated from the
// plugin editor, whose complete payload may explicitly remove unsupported data.
func (s *Service) resolveProviderSaveRuntimeLocked(config, existing ai.ProviderConfig, found, localCLIAuth bool) (ai.ProviderConfig, error) {
	if isPluginProviderConfig(config) {
		return s.resolvePluginProviderSaveLocked(config, existing, found)
	}
	meta, bundle := splitProviderSecrets(config)
	preserveExistingSecrets := found && ((!localCLIAuth && !isLocalCLIAuthProvider(existing)) ||
		(localCLIAuth && singletonCLIProviderIdentity(existing) == singletonCLIProviderIdentity(config)))
	var runtimeConfig ai.ProviderConfig
	switch {
	case bundle.hasAny():
		mergedBundle := bundle
		if preserveExistingSecrets && existing.HasSecret {
			_, existingBundle := splitProviderSecrets(existing)
			mergedBundle = mergeProviderSecretBundles(existingBundle, bundle)
		}
		if found && strings.TrimSpace(meta.SecretRef) == "" {
			meta.SecretRef = existing.SecretRef
		}
		storedMeta, err := s.persistProviderSecretBundle(meta, mergedBundle)
		if err != nil {
			return ai.ProviderConfig{}, s.serviceErrorLocked("ai_service.backend.error.provider_secret_save_failed", nil, err)
		}
		runtimeConfig = mergeProviderSecrets(storedMeta, mergedBundle)
	case preserveExistingSecrets && (config.HasSecret || existing.HasSecret):
		meta.SecretRef = existing.SecretRef
		meta.HasSecret = config.HasSecret || existing.HasSecret
		meta, existingBundle := applyExistingRuntimeProviderSecrets(meta, existing)
		if existingBundle.hasAny() {
			runtimeConfig = mergeProviderSecrets(meta, existingBundle)
		} else {
			resolved, err := s.resolveProviderConfigSecretsLocked(meta)
			if err != nil {
				return ai.ProviderConfig{}, s.serviceErrorLocked("ai_service.backend.error.provider_secret_saved_read_failed", nil, err)
			}
			runtimeConfig = resolved
		}
	default:
		runtimeConfig = meta
	}

	return runtimeConfig, nil
}

func (s *Service) mergePluginProviderEditLocked(config, existing ai.ProviderConfig, found bool) (ai.ProviderConfig, error) {
	if err := validatePluginProviderConfig(config); err != nil {
		return ai.ProviderConfig{}, err
	}
	meta, incoming := splitProviderSecrets(config)
	var previous providerSecretBundle
	if found {
		_, previous = splitProviderSecrets(existing)
		if !previous.hasAny() && existing.HasSecret {
			stored, ok, err := s.dailySecretStore().GetAIProvider(existing.ID)
			if err != nil || !ok {
				return ai.ProviderConfig{}, errors.New("selected saved provider credential is unavailable")
			}
			previous = fromDailyProviderBundle(stored)
		}
	}
	if config.CLIEnv != nil {
		previous.CLIEnv = nil // Explicit empty object corrects an imported foreign field.
	}
	if config.Headers != nil && len(config.Headers) == 0 {
		previous.SensitiveHeaders = nil // Only an explicit empty object clears opaque secret headers.
	}
	// Nonempty maps are public-header snapshots plus explicit secret overrides.
	// Omitted/redacted secret values retain the selected existing secret bundle.
	// Only explicit nonempty secret overrides replace equivalent HTTP identities.
	// Redacted values never enter incoming.SensitiveHeaders; old data stays intact.
	for name := range incoming.SensitiveHeaders {
		for old := range previous.SensitiveHeaders {
			if old != name && strings.EqualFold(old, name) {
				delete(previous.SensitiveHeaders, old)
			}
		}
	}
	merged := mergeProviderSecretBundles(previous, incoming)
	resolved := mergeProviderSecrets(meta, merged)
	if err := validatePluginProviderConfig(resolved); err != nil {
		return ai.ProviderConfig{}, err
	}
	return resolved, nil
}

func (s *Service) resolvePluginProviderSaveLocked(config, existing ai.ProviderConfig, found bool) (ai.ProviderConfig, error) {
	resolved, err := s.mergePluginProviderEditLocked(config, existing, found)
	if err != nil {
		return ai.ProviderConfig{}, err
	}
	meta, bundle := splitProviderSecrets(resolved)
	stored, err := s.persistProviderSecretBundle(meta, bundle)
	if err != nil {
		return ai.ProviderConfig{}, s.serviceErrorLocked("ai_service.backend.error.provider_secret_save_failed", nil, err)
	}
	return mergeProviderSecrets(stored, bundle), nil
}

func (s *Service) resolvePluginProviderDraft(config ai.ProviderConfig) (ai.ProviderConfig, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	// A new draft has no saved identity, including imported empty-ID records.
	if config.ID == "" {
		return s.mergePluginProviderEditLocked(config, ai.ProviderConfig{}, false)
	}
	for _, existing := range s.providers {
		if existing.ID == config.ID {
			return s.mergePluginProviderEditLocked(config, existing, true)
		}
	}
	return s.mergePluginProviderEditLocked(config, ai.ProviderConfig{}, false)
}
