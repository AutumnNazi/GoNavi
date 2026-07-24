package app

import (
	"reflect"
	"strings"
	"testing"
)

func TestStreamSQLFileDropsCommentOnlyTail(t *testing.T) {
	t.Parallel()

	var statements []string
	count, err := streamSQLFile(
		strings.NewReader("DELETE FROM users WHERE id = 1; -- keep this operation pending"),
		func(_ int, statement string) error {
			statements = append(statements, statement)
			return nil
		},
	)
	if err != nil {
		t.Fatalf("streamSQLFile returned error: %v", err)
	}
	if count != 1 {
		t.Fatalf("expected one executable statement, got %d", count)
	}
	want := []string{"DELETE FROM users WHERE id = 1"}
	if !reflect.DeepEqual(statements, want) {
		t.Fatalf("expected statements %#v, got %#v", want, statements)
	}
}

func TestSQLStreamSplitterPreservesExecutableMySQLComment(t *testing.T) {
	t.Parallel()

	splitter := &sqlStreamSplitter{}
	got := splitter.Feed([]byte("/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;"))
	want := []string{"/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("expected statements %#v, got %#v", want, got)
	}
}
