package plugin

import (
	"strings"
	"testing"
)

func TestValidateSkillDocumentByteBound(t *testing.T) {
	if err := ValidateSkillDocument([]byte(strings.Repeat("文", 21845))); err != nil {
		t.Fatal(err)
	}
	if err := ValidateSkillDocument([]byte(" \n\t")); err != nil {
		t.Fatal(err)
	}
	err := ValidateSkillDocument([]byte(strings.Repeat("文", 21846)))
	if err == nil || strings.Contains(err.Error(), "文") {
		t.Fatal(err)
	}
	if ValidateSkillDocument(nil) == nil || ValidateSkillDocument([]byte("a\x00b")) == nil {
		t.Fatal("empty or NUL document was accepted")
	}
}
