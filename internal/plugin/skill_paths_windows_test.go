package plugin

import "testing"

func TestSkillWindowsExtendedPathSemantics(t *testing.T) {
	cases := map[string]string{
		`C:\Users\user\plugins`:        `\\?\C:\Users\user\plugins`,
		`\\server\share\plugins`:       `\\?\UNC\server\share\plugins`,
		`\\?\C:\Users\user\plugins`:    `\\?\C:\Users\user\plugins`,
		`\\?\UNC\server\share\plugins`: `\\?\UNC\server\share\plugins`,
	}
	for source, want := range cases {
		if got := extendedPackagePath(source); got != want {
			t.Fatalf("extended path %q -> %q; want %q", source, got, want)
		}
	}
}
