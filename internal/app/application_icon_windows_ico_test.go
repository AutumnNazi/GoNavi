package app

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
	"time"

	"golang.org/x/image/draw"
)

func TestBuildWindowsApplicationIconContainsNativeFrames(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 64, 64))
	for y := 0; y < 64; y++ {
		for x := 0; x < 64; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 4), G: uint8(y * 4), B: 0x80, A: 0xff})
		}
	}
	var sourcePNG bytes.Buffer
	if err := png.Encode(&sourcePNG, source); err != nil {
		t.Fatal(err)
	}

	ico, err := buildWindowsApplicationIconICO(sourcePNG.Bytes())
	if err != nil {
		t.Fatalf("build Windows ICO: %v", err)
	}
	if len(ico) < 6 || binary.LittleEndian.Uint16(ico[0:2]) != 0 || binary.LittleEndian.Uint16(ico[2:4]) != 1 {
		t.Fatal("invalid ICO header")
	}

	entries, err := parseWindowsICOEntries(ico)
	if err != nil {
		t.Fatalf("parse Windows ICO: %v", err)
	}
	if len(entries) != len(windowsApplicationIconSizes) {
		t.Fatalf("ICO entry count = %d, want %d", len(entries), len(windowsApplicationIconSizes))
	}

	wantSizes := map[int]bool{16: false, 24: false, 32: false, 48: false, 64: false, 128: false, 256: false}
	for _, entry := range entries {
		if entry.Width != entry.Height {
			t.Fatalf("ICO frame is not square: %dx%d", entry.Width, entry.Height)
		}
		if entry.Width == windowsApplicationIconPNGSize {
			if !windowsICOPayloadIsPNG(entry.Payload) {
				t.Fatalf("ICO %dx%d frame is not PNG", entry.Width, entry.Height)
			}
			decoded, format, err := image.Decode(bytes.NewReader(entry.Payload))
			if err != nil {
				t.Fatalf("decode ICO %dx%d frame: %v", entry.Width, entry.Height, err)
			}
			if format != "png" || decoded.Bounds().Dx() != entry.Width || decoded.Bounds().Dy() != entry.Height {
				t.Fatalf("ICO frame = %s %dx%d, want PNG %dx%d", format, decoded.Bounds().Dx(), decoded.Bounds().Dy(), entry.Width, entry.Height)
			}
		} else {
			if windowsICOPayloadIsPNG(entry.Payload) {
				t.Fatalf("ICO %dx%d frame is PNG; Windows 10 requires a BMP DIB", entry.Width, entry.Height)
			}
			decoded, err := decodeWindowsICOBitmapFrame(entry.Payload)
			if err != nil {
				t.Fatalf("decode ICO %dx%d BMP frame: %v", entry.Width, entry.Height, err)
			}
			if decoded.Bounds().Dx() != entry.Width || decoded.Bounds().Dy() != entry.Height {
				t.Fatalf("ICO BMP frame = %dx%d, want %dx%d", decoded.Bounds().Dx(), decoded.Bounds().Dy(), entry.Width, entry.Height)
			}
		}
		if _, required := wantSizes[entry.Width]; required {
			wantSizes[entry.Width] = true
		}
	}
	for size, found := range wantSizes {
		if !found {
			t.Errorf("ICO is missing %dx%d frame", size, size)
		}
	}
}

func TestEncodeWindowsICOBitmapFrameUsesANDMaskForTransparency(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 16, 16))
	for y := 0; y < 16; y++ {
		for x := 0; x < 16; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: 0x22, G: 0x66, B: 0xaa, A: 0xff})
		}
	}
	source.SetNRGBA(0, 0, color.NRGBA{})
	source.SetNRGBA(15, 15, color.NRGBA{})

	payload := encodeWindowsICOBitmapFrame(source)
	decoded, err := decodeWindowsICOBitmapFrame(payload)
	if err != nil {
		t.Fatalf("decode BMP frame: %v", err)
	}
	if got := decoded.NRGBAAt(1, 1); got != (color.NRGBA{R: 0x22, G: 0x66, B: 0xaa, A: 0xff}) {
		t.Fatalf("opaque pixel = %+v", got)
	}
	if got := decoded.NRGBAAt(0, 0); got.A != 0 {
		t.Fatalf("transparent corner alpha = %d, want 0", got.A)
	}
	if !windowsICOANDMaskSet(payload, 16, 16, 0, 0) {
		t.Fatal("transparent corner is missing from the AND mask")
	}
	if windowsICOANDMaskSet(payload, 16, 16, 1, 1) {
		t.Fatal("opaque pixel must not set the AND mask")
	}
}

func TestMigrateWindowsApplicationIconRewritesPNGSmallFrames(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 32, 32))
	for y := 0; y < 32; y++ {
		for x := 0; x < 32; x++ {
			source.SetNRGBA(x, y, color.NRGBA{R: 0x40, G: uint8(x * 7), B: 0xc0, A: 0xff})
		}
	}
	var sourcePNG bytes.Buffer
	if err := png.Encode(&sourcePNG, source); err != nil {
		t.Fatal(err)
	}
	legacy, err := buildLegacyPNGOnlyWindowsApplicationIconICO(sourcePNG.Bytes())
	if err != nil {
		t.Fatalf("build legacy PNG ICO: %v", err)
	}
	entries, err := parseWindowsICOEntries(legacy)
	if err != nil {
		t.Fatalf("parse legacy ICO: %v", err)
	}
	if !windowsICOEntriesNeedNativeFrameMigration(entries) {
		t.Fatal("legacy PNG-only ICO was not flagged for Windows 10 migration")
	}

	root := t.TempDir()
	iconPath := filepath.Join(root, "gonavi-brand-legacy.ico")
	if err := os.WriteFile(iconPath, legacy, 0o644); err != nil {
		t.Fatal(err)
	}
	if err := migrateWindowsApplicationIconFile(iconPath); err != nil {
		t.Fatalf("migrate Windows ICO: %v", err)
	}
	migrated, err := os.ReadFile(iconPath)
	if err != nil {
		t.Fatalf("read migrated ICO: %v", err)
	}
	migratedEntries, err := parseWindowsICOEntries(migrated)
	if err != nil {
		t.Fatalf("parse migrated ICO: %v", err)
	}
	if windowsICOEntriesNeedNativeFrameMigration(migratedEntries) {
		t.Fatal("migrated ICO still contains PNG frames below 256px")
	}
	if err := migrateWindowsApplicationIconFile(iconPath); err != nil {
		t.Fatalf("second migrate should be a no-op: %v", err)
	}
}

func TestPersistWindowsApplicationIconDoesNotNeedMigration(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 8, 8))
	source.SetNRGBA(0, 0, color.NRGBA{R: 0x10, G: 0x20, B: 0x30, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	iconPath, err := persistWindowsApplicationIcon(encoded.Bytes(), root)
	if err != nil {
		t.Fatalf("persist icon: %v", err)
	}
	data, err := os.ReadFile(iconPath)
	if err != nil {
		t.Fatal(err)
	}
	entries, err := parseWindowsICOEntries(data)
	if err != nil {
		t.Fatalf("parse persisted ICO: %v", err)
	}
	if windowsICOEntriesNeedNativeFrameMigration(entries) {
		t.Fatal("newly persisted ICO still uses PNG frames below 256px")
	}
}

func TestPersistWindowsApplicationIconUsesContentAddressedPath(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	source.SetNRGBA(0, 0, color.NRGBA{R: 0x33, G: 0x66, B: 0x99, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	pngBytes := encoded.Bytes()
	root := t.TempDir()
	first, err := persistWindowsApplicationIcon(pngBytes, root)
	if err != nil {
		t.Fatalf("persist first icon: %v", err)
	}
	second, err := persistWindowsApplicationIcon(pngBytes, root)
	if err != nil {
		t.Fatalf("persist same icon again: %v", err)
	}
	if first != second {
		t.Fatalf("same image paths differ: %q != %q", first, second)
	}
	if filepath.Ext(first) != ".ico" || filepath.Base(filepath.Dir(first)) != windowsApplicationIconDirectoryName {
		t.Fatalf("unexpected icon path: %q", first)
	}
	info, err := os.Stat(first)
	if err != nil {
		t.Fatalf("stat persisted icon: %v", err)
	}
	if info.Size() <= 6 {
		t.Fatalf("persisted icon is too small: %d", info.Size())
	}
	if err := os.WriteFile(first, []byte("corrupt"), 0o644); err != nil {
		t.Fatal(err)
	}
	repaired, err := persistWindowsApplicationIcon(pngBytes, root)
	if err != nil {
		t.Fatalf("repair corrupted icon: %v", err)
	}
	if repaired != first {
		t.Fatalf("repaired icon path = %q, want %q", repaired, first)
	}
	if repairedInfo, err := os.Stat(repaired); err != nil || repairedInfo.Size() <= int64(len("corrupt")) {
		t.Fatalf("corrupted icon was not replaced: info=%v err=%v", repairedInfo, err)
	}
}

func TestPersistWindowsApplicationIconRecordsActiveIcon(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	source.SetNRGBA(0, 0, color.NRGBA{R: 0x44, G: 0x88, B: 0xcc, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	iconPath, err := persistWindowsApplicationIcon(encoded.Bytes(), root)
	if err != nil {
		t.Fatalf("persist icon: %v", err)
	}
	if err := activatePersistedWindowsApplicationIcon(iconPath, root); err != nil {
		t.Fatalf("activate icon: %v", err)
	}
	activePath, err := loadPersistedWindowsApplicationIcon(root)
	if err != nil {
		t.Fatalf("load active icon: %v", err)
	}
	if activePath != iconPath {
		t.Fatalf("active icon path = %q, want %q", activePath, iconPath)
	}
}

func TestLoadPersistedWindowsApplicationIconFallsBackToNewestLegacyIcon(t *testing.T) {
	makePNG := func(value uint8) []byte {
		source := image.NewNRGBA(image.Rect(0, 0, 2, 2))
		source.SetNRGBA(0, 0, color.NRGBA{R: value, G: 0x22, B: 0x77, A: 0xff})
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, source); err != nil {
			t.Fatal(err)
		}
		return encoded.Bytes()
	}
	root := t.TempDir()
	older, err := persistWindowsApplicationIcon(makePNG(0x11), root)
	if err != nil {
		t.Fatalf("persist older icon: %v", err)
	}
	newer, err := persistWindowsApplicationIcon(makePNG(0xee), root)
	if err != nil {
		t.Fatalf("persist newer icon: %v", err)
	}
	olderTime := time.Now().Add(-2 * time.Minute)
	newerTime := time.Now().Add(-time.Minute)
	if err := os.Chtimes(older, olderTime, olderTime); err != nil {
		t.Fatalf("touch older icon: %v", err)
	}
	if err := os.Chtimes(newer, newerTime, newerTime); err != nil {
		t.Fatalf("touch newer icon: %v", err)
	}

	got, err := loadPersistedWindowsApplicationIcon(root)
	if err != nil {
		t.Fatalf("load legacy icon: %v", err)
	}
	if got != newer {
		t.Fatalf("legacy icon = %q, want newest %q", got, newer)
	}
}

func TestEmptyWindowsApplicationIconStateSuppressesLegacyFallback(t *testing.T) {
	source := image.NewNRGBA(image.Rect(0, 0, 2, 2))
	source.SetNRGBA(0, 0, color.NRGBA{R: 0xaa, G: 0x44, B: 0x22, A: 0xff})
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, source); err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	if _, err := persistWindowsApplicationIcon(encoded.Bytes(), root); err != nil {
		t.Fatalf("persist legacy icon: %v", err)
	}
	if err := clearPersistedWindowsApplicationIcon(root); err != nil {
		t.Fatalf("clear active icon state: %v", err)
	}

	got, err := loadPersistedWindowsApplicationIcon(root)
	if err != nil {
		t.Fatalf("load empty active state: %v", err)
	}
	if got != "" {
		t.Fatalf("icon selected with empty active state = %q, want empty", got)
	}
}

func windowsICOANDMaskSet(payload []byte, width, height, x, y int) bool {
	xorSize := width * height * 4
	andRowSize := ((width + 31) / 32) * 4
	and := payload[windowsICOBitmapHeaderSize+xorSize:]
	destRow := height - 1 - y
	row := and[destRow*andRowSize:]
	return row[x/8]&(1<<(7-uint(x%8))) != 0
}

func buildLegacyPNGOnlyWindowsApplicationIconICO(pngBytes []byte) ([]byte, error) {
	source, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, err
	}
	frames := make([][]byte, 0, len(windowsApplicationIconSizes))
	for _, size := range windowsApplicationIconSizes {
		target := image.NewNRGBA(image.Rect(0, 0, size, size))
		draw.CatmullRom.Scale(target, target.Bounds(), source, source.Bounds(), draw.Over, nil)
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, target); err != nil {
			return nil, err
		}
		frames = append(frames, encoded.Bytes())
	}
	const headerSize = 6
	const directoryEntrySize = 16
	payloadOffset := headerSize + (directoryEntrySize * len(frames))
	var ico bytes.Buffer
	_ = binary.Write(&ico, binary.LittleEndian, uint16(0))
	_ = binary.Write(&ico, binary.LittleEndian, uint16(1))
	_ = binary.Write(&ico, binary.LittleEndian, uint16(len(frames)))
	for index, frame := range frames {
		size := windowsApplicationIconSizes[index]
		encodedSize := byte(size)
		if size == windowsApplicationIconPNGSize {
			encodedSize = 0
		}
		ico.WriteByte(encodedSize)
		ico.WriteByte(encodedSize)
		ico.WriteByte(0)
		ico.WriteByte(0)
		_ = binary.Write(&ico, binary.LittleEndian, uint16(1))
		_ = binary.Write(&ico, binary.LittleEndian, uint16(32))
		_ = binary.Write(&ico, binary.LittleEndian, uint32(len(frame)))
		_ = binary.Write(&ico, binary.LittleEndian, uint32(payloadOffset))
		payloadOffset += len(frame)
	}
	for _, frame := range frames {
		_, _ = ico.Write(frame)
	}
	return ico.Bytes(), nil
}
