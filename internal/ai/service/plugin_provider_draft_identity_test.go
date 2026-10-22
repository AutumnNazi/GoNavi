package aiservice

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPluginProviderEmptyDraftCannotBorrowCollidingSavedSecrets(t *testing.T) {
	type observed struct{ authorization, apiKey string }
	received := make(chan observed, 2)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		received <- observed{authorization: r.Header.Get("Authorization"), apiKey: r.Header.Get("X-Api-Key")}
		providerSSE(t, w, providerHelloSSE+providerDoneSSE)
	}))
	t.Cleanup(upstream.Close)
	fixture := newNativeProviderServiceFixture(t, upstream.URL+"/v1")
	saved := cloneAgentProviderConfig(fixture.config)
	saved.ID = "plugin-provider-draft" // An ordinary user-selected persisted ID, not reserved.
	saved.APIKey = "unrelated-saved-secret"
	saved.Headers = map[string]string{"X-Api-Key": "unrelated-saved-header"}
	if err := fixture.service.AISaveProvider(saved); err != nil {
		t.Fatal(err)
	}
	for _, explicitKey := range []string{"", "explicit-draft-secret"} {
		draft := cloneAgentProviderConfig(fixture.config)
		draft.ID, draft.APIKey, draft.HasSecret, draft.SecretRef = "", explicitKey, false, ""
		draft.Headers = nil
		result := fixture.service.AITestProvider(draft)
		if result["success"] != true {
			t.Fatalf("new draft health failed: %+v", result)
		}
		actual := <-received
		expected := ""
		if explicitKey != "" {
			expected = "Bearer " + explicitKey
		}
		if actual.authorization != expected || actual.apiKey != "" {
			t.Error("empty-ID draft borrowed an unrelated persisted credential/header")
		}
	}
}
