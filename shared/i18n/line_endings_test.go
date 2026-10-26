package i18n

import (
	"bytes"
	"os"
	"testing"
)

// .gitattributes pins shared/i18n/*.json to eol=lf and the zip generator normalizes CRLF to LF.
// A CRLF working copy therefore fails TestCatalogZipInSyncWithJSON with a message about
// regeneration, which sends the reader down the wrong path. This check names the real cause.
func TestCatalogFilesUseLF(t *testing.T) {
	for _, language := range supportedLanguageOrder {
		name := string(language) + ".json"
		payload, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("读取 %s 失败: %v", name, err)
		}
		if bytes.Contains(payload, []byte("\r\n")) {
			t.Errorf("%s 使用了 CRLF 换行；.gitattributes 要求 eol=lf，请转换为 LF 后再执行 go generate ./shared/i18n", name)
		}
	}
}
