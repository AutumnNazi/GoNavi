package market

import (
	"archive/tar"
	"bytes"
	"context"
	"io/fs"
	"testing"
)

func TestArtifactSkillsRejectMissingAliasedAndNonregularEntries(t *testing.T) {
	cases := []struct {
		name    string
		entries []artifactTestEntry
	}{
		{name: "missing"},
		{name: "case alias", entries: []artifactTestEntry{{name: "Skills/notes/SKILL.md", body: []byte("Text")}}},
		{name: "directory", entries: []artifactTestEntry{{name: artifactSkillTestEntry + "/", mode: fs.ModeDir | 0755, tarType: tar.TypeDir}}},
		{name: "symlink", entries: []artifactTestEntry{{name: artifactSkillTestEntry, mode: fs.ModeSymlink | 0777, tarType: tar.TypeSymlink, linkname: "../../outside"}}},
		{name: "path escape", entries: []artifactTestEntry{{name: "../SKILL.md", body: []byte("Text")}}},
		{name: "duplicate case", entries: []artifactTestEntry{{name: artifactSkillTestEntry, body: []byte("Text")}, {name: "skills/notes/skill.md", body: []byte("Other")}}},
		{name: "duplicate path", entries: []artifactTestEntry{{name: artifactSkillTestEntry, body: []byte("Text")}, {name: artifactSkillTestEntry, body: []byte("Other")}}},
	}
	for _, format := range []string{".zip", ".tgz"} {
		for _, test := range cases {
			t.Run(format+"/"+test.name, func(t *testing.T) {
				entries := append([]artifactTestEntry{{name: artifactManifestName, body: []byte(artifactSkillManifest(t, nil))}}, test.entries...)
				filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
				if _, err := ValidatePackage(context.Background(), filename); err == nil {
					t.Fatal("accepted missing, aliased, linked or nonregular skill entry")
				}
			})
		}
	}
}

func TestArtifactSkillsRejectTarHardlinksAndZIPLinkMetadata(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			document := artifactTestEntry{name: artifactSkillTestEntry, tarType: tar.TypeLink, linkname: "outside/SKILL.md", extra: []byte{0x0d, 0, 0, 0}}
			entries := []artifactTestEntry{{name: artifactManifestName, body: []byte(artifactSkillManifest(t, nil))}, document}
			filename := artifactTestWrite(t, format, artifactTestArchive(t, format, entries))
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("accepted linked skill metadata")
			}
		})
	}
}

func TestArtifactSkillsStillValidateArchiveIntegrityAtDocumentLimit(t *testing.T) {
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			body := bytes.Repeat([]byte("x"), 64<<10)
			_, payload := artifactSkillArchive(t, format, artifactSkillManifest(t, nil), artifactSkillTestEntry, body)
			if format == ".zip" {
				offset := bytes.Index(payload, body)
				if offset < 0 {
					t.Fatal("missing stored document fixture")
				}
				payload[offset+13] ^= 1
			} else {
				payload[len(payload)-8] ^= 1
			}
			filename := artifactTestWrite(t, format, payload)
			if _, err := ValidatePackage(context.Background(), filename); err == nil {
				t.Fatal("skill content scan skipped archive checksum verification")
			}
		})
	}
}

func TestArtifactSkillsInspectionRetainsNoDocumentBody(t *testing.T) {
	body := []byte("DO_NOT_RETAIN_SKILL_BODY")
	manifest := artifactSkillManifest(t, nil)
	for _, format := range []string{".zip", ".tgz"} {
		t.Run(format, func(t *testing.T) {
			_, payload := artifactSkillArchive(t, format, manifest, artifactSkillTestEntry, body)
			index := artifactIndex{paths: make(map[string]artifactPath)}
			var err error
			if format == ".zip" {
				err = index.readZIP(context.Background(), payload)
			} else {
				err = index.readTGZ(context.Background(), payload)
			}
			if err != nil {
				t.Fatal(err)
			}
			if len(index.skillDocuments) != 1 || !index.skillDocuments[artifactSkillTestEntry] {
				t.Fatal("missing exact declared-document validation marker")
			}
			if !bytes.Equal(index.manifest, []byte(manifest)) {
				t.Fatal("document content changed retained manifest")
			}
		})
	}
}
