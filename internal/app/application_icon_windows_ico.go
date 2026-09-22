package app

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/image/draw"
)

const (
	windowsApplicationIconDirectoryName = "application-icons"
	windowsApplicationIconStateFileName = "active-icon.txt"
	windowsApplicationIconPNGSize       = 256
	windowsICOBitmapHeaderSize          = 40
	windowsICOBitmapBitCount            = 32
)

var windowsApplicationIconSizes = []int{16, 24, 32, 48, 64, 128, windowsApplicationIconPNGSize}

var windowsICOPNGMagic = []byte{0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a}

type windowsICODirectoryEntry struct {
	Width    int
	Height   int
	BitCount uint16
	Payload  []byte
}

func buildWindowsApplicationIconICO(pngBytes []byte) ([]byte, error) {
	source, err := png.Decode(bytes.NewReader(pngBytes))
	if err != nil {
		return nil, fmt.Errorf("decode application icon PNG: %w", err)
	}
	return encodeWindowsApplicationIconICO(source)
}

func encodeWindowsApplicationIconICO(source image.Image) ([]byte, error) {
	if source == nil {
		return nil, errors.New("application icon source is nil")
	}

	frames := make([][]byte, 0, len(windowsApplicationIconSizes))
	for _, size := range windowsApplicationIconSizes {
		target := image.NewNRGBA(image.Rect(0, 0, size, size))
		draw.CatmullRom.Scale(target, target.Bounds(), source, source.Bounds(), draw.Over, nil)
		frame, err := encodeWindowsApplicationIconFrame(target, size)
		if err != nil {
			return nil, err
		}
		frames = append(frames, frame)
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
		_ = binary.Write(&ico, binary.LittleEndian, uint16(windowsICOBitmapBitCount))
		_ = binary.Write(&ico, binary.LittleEndian, uint32(len(frame)))
		_ = binary.Write(&ico, binary.LittleEndian, uint32(payloadOffset))
		payloadOffset += len(frame)
	}
	for _, frame := range frames {
		_, _ = ico.Write(frame)
	}
	return ico.Bytes(), nil
}

// encodeWindowsApplicationIconFrame writes Vista-style PNG only for the 256px
// jumbo frame. Windows 10 Explorer's IExtractIcon / shortcut loader rejects
// PNG-compressed 16–128px entries and then falls back to the executable icon,
// which is why Win11 (more lenient) showed the selected mascot while Win10
// kept the default GN tile.
func encodeWindowsApplicationIconFrame(img *image.NRGBA, size int) ([]byte, error) {
	if img == nil {
		return nil, errors.New("application icon frame is nil")
	}
	if size == windowsApplicationIconPNGSize {
		var encoded bytes.Buffer
		if err := png.Encode(&encoded, img); err != nil {
			return nil, fmt.Errorf("encode %dx%d application icon frame: %w", size, size, err)
		}
		return encoded.Bytes(), nil
	}
	return encodeWindowsICOBitmapFrame(img), nil
}

func encodeWindowsICOBitmapFrame(img *image.NRGBA) []byte {
	width := img.Bounds().Dx()
	height := img.Bounds().Dy()
	xorSize := width * height * 4
	andRowSize := ((width + 31) / 32) * 4
	andSize := andRowSize * height

	payload := make([]byte, windowsICOBitmapHeaderSize+xorSize+andSize)
	binary.LittleEndian.PutUint32(payload[0:4], windowsICOBitmapHeaderSize)
	binary.LittleEndian.PutUint32(payload[4:8], uint32(width))
	binary.LittleEndian.PutUint32(payload[8:12], uint32(height*2))
	binary.LittleEndian.PutUint16(payload[12:14], 1)
	binary.LittleEndian.PutUint16(payload[14:16], windowsICOBitmapBitCount)
	// biSizeImage is the XOR bitmap only. Counting the AND mask makes Windows 10's
	// icon extractor reject the file and keep the executable icon.
	binary.LittleEndian.PutUint32(payload[20:24], uint32(xorSize))

	xor := payload[windowsICOBitmapHeaderSize : windowsICOBitmapHeaderSize+xorSize]
	and := payload[windowsICOBitmapHeaderSize+xorSize:]
	for destRow := 0; destRow < height; destRow++ {
		srcY := height - 1 - destRow
		xorRow := xor[destRow*width*4:]
		andRow := and[destRow*andRowSize:]
		for x := 0; x < width; x++ {
			pixel := img.NRGBAAt(img.Bounds().Min.X+x, img.Bounds().Min.Y+srcY)
			offset := x * 4
			if pixel.A == 0 {
				xorRow[offset] = 0
				xorRow[offset+1] = 0
				xorRow[offset+2] = 0
				xorRow[offset+3] = 0
				andRow[x/8] |= 1 << (7 - uint(x%8))
				continue
			}
			xorRow[offset] = pixel.B
			xorRow[offset+1] = pixel.G
			xorRow[offset+2] = pixel.R
			xorRow[offset+3] = pixel.A
		}
	}
	return payload
}

func windowsICOPayloadIsPNG(payload []byte) bool {
	return len(payload) >= len(windowsICOPNGMagic) && bytes.Equal(payload[:len(windowsICOPNGMagic)], windowsICOPNGMagic)
}

func parseWindowsICOEntries(ico []byte) ([]windowsICODirectoryEntry, error) {
	if len(ico) < 6 {
		return nil, errors.New("truncated ICO header")
	}
	if binary.LittleEndian.Uint16(ico[0:2]) != 0 || binary.LittleEndian.Uint16(ico[2:4]) != 1 {
		return nil, errors.New("invalid ICO header")
	}
	count := int(binary.LittleEndian.Uint16(ico[4:6]))
	if count <= 0 || len(ico) < 6+(count*16) {
		return nil, errors.New("truncated ICO directory")
	}
	entries := make([]windowsICODirectoryEntry, 0, count)
	for index := 0; index < count; index++ {
		offset := 6 + (index * 16)
		width := int(ico[offset])
		if width == 0 {
			width = windowsApplicationIconPNGSize
		}
		height := int(ico[offset+1])
		if height == 0 {
			height = windowsApplicationIconPNGSize
		}
		payloadSize := int(binary.LittleEndian.Uint32(ico[offset+8 : offset+12]))
		payloadOffset := int(binary.LittleEndian.Uint32(ico[offset+12 : offset+16]))
		if payloadOffset < 0 || payloadSize <= 0 || payloadOffset > len(ico)-payloadSize {
			return nil, fmt.Errorf("truncated ICO %dx%d frame", width, height)
		}
		entries = append(entries, windowsICODirectoryEntry{
			Width:    width,
			Height:   height,
			BitCount: binary.LittleEndian.Uint16(ico[offset+6 : offset+8]),
			Payload:  ico[payloadOffset : payloadOffset+payloadSize],
		})
	}
	return entries, nil
}

func windowsICOEntriesNeedNativeFrameMigration(entries []windowsICODirectoryEntry) bool {
	for _, entry := range entries {
		if entry.Width != windowsApplicationIconPNGSize && windowsICOPayloadIsPNG(entry.Payload) {
			return true
		}
	}
	return false
}

func decodeWindowsICOSourceImageFromEntries(entries []windowsICODirectoryEntry) (image.Image, error) {
	var best []byte
	bestSize := -1
	for _, entry := range entries {
		if !windowsICOPayloadIsPNG(entry.Payload) {
			continue
		}
		if entry.Width >= bestSize {
			best = entry.Payload
			bestSize = entry.Width
		}
	}
	if best == nil {
		return nil, errors.New("ICO has no PNG source frame")
	}
	source, err := png.Decode(bytes.NewReader(best))
	if err != nil {
		return nil, fmt.Errorf("decode ICO PNG source frame: %w", err)
	}
	return source, nil
}

func decodeWindowsICOBitmapFrame(payload []byte) (*image.NRGBA, error) {
	if len(payload) < windowsICOBitmapHeaderSize {
		return nil, errors.New("truncated ICO bitmap header")
	}
	if binary.LittleEndian.Uint32(payload[0:4]) != windowsICOBitmapHeaderSize {
		return nil, errors.New("unsupported ICO bitmap header")
	}
	width := int(int32(binary.LittleEndian.Uint32(payload[4:8])))
	heightTwice := int(int32(binary.LittleEndian.Uint32(payload[8:12])))
	if width <= 0 || heightTwice <= 0 || heightTwice%2 != 0 {
		return nil, errors.New("invalid ICO bitmap dimensions")
	}
	height := heightTwice / 2
	if binary.LittleEndian.Uint16(payload[14:16]) != windowsICOBitmapBitCount {
		return nil, errors.New("unsupported ICO bitmap bit count")
	}
	xorSize := width * height * 4
	if len(payload) < windowsICOBitmapHeaderSize+xorSize {
		return nil, errors.New("truncated ICO bitmap pixels")
	}
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	xor := payload[windowsICOBitmapHeaderSize : windowsICOBitmapHeaderSize+xorSize]
	for y := 0; y < height; y++ {
		srcRow := xor[(height-1-y)*width*4:]
		for x := 0; x < width; x++ {
			offset := x * 4
			img.SetNRGBA(x, y, color.NRGBA{
				R: srcRow[offset+2],
				G: srcRow[offset+1],
				B: srcRow[offset],
				A: srcRow[offset+3],
			})
		}
	}
	return img, nil
}

func migrateWindowsApplicationIconFile(iconPath string) error {
	iconPath = strings.TrimSpace(iconPath)
	if iconPath == "" {
		return errors.New("Windows application icon path is empty")
	}
	data, err := os.ReadFile(iconPath)
	if err != nil {
		return fmt.Errorf("read Windows application icon: %w", err)
	}
	entries, err := parseWindowsICOEntries(data)
	if err != nil {
		return fmt.Errorf("parse Windows application icon: %w", err)
	}
	if !windowsICOEntriesNeedNativeFrameMigration(entries) {
		return nil
	}
	source, err := decodeWindowsICOSourceImageFromEntries(entries)
	if err != nil {
		return err
	}
	rebuilt, err := encodeWindowsApplicationIconICO(source)
	if err != nil {
		return err
	}
	if err := writeWindowsApplicationIconFile(iconPath, rebuilt); err != nil {
		return fmt.Errorf("migrate Windows application icon: %w", err)
	}
	return nil
}

func windowsApplicationIconCandidatePath(pngBytes []byte, configDir string) string {
	hash := sha256.Sum256(pngBytes)
	return filepath.Join(strings.TrimSpace(configDir), windowsApplicationIconDirectoryName, fmt.Sprintf("gonavi-brand-%x.ico", hash[:12]))
}

func persistWindowsApplicationIcon(pngBytes []byte, configDir string) (string, error) {
	configDir = strings.TrimSpace(configDir)
	if configDir == "" {
		return "", errors.New("application config directory is empty")
	}
	ico, err := buildWindowsApplicationIconICO(pngBytes)
	if err != nil {
		return "", err
	}
	iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		return "", fmt.Errorf("create Windows application icon directory: %w", err)
	}
	iconPath := windowsApplicationIconCandidatePath(pngBytes, configDir)
	if err := writeWindowsApplicationIconFile(iconPath, ico); err != nil {
		return "", err
	}
	return iconPath, nil
}

func writeWindowsApplicationIconFile(iconPath string, ico []byte) error {
	if existing, err := os.ReadFile(iconPath); err == nil && bytes.Equal(existing, ico) {
		return nil
	}
	iconDir := filepath.Dir(iconPath)
	temporary, err := os.CreateTemp(iconDir, ".gonavi-brand-*.ico.tmp")
	if err != nil {
		return fmt.Errorf("create temporary Windows application icon: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(ico); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write Windows application icon: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Windows application icon: %w", err)
	}
	if err := os.Remove(iconPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("replace Windows application icon: %w", err)
	}
	if err := os.Rename(temporaryPath, iconPath); err != nil {
		return fmt.Errorf("commit Windows application icon: %w", err)
	}
	return nil
}

func activatePersistedWindowsApplicationIcon(iconPath, configDir string) error {
	configDir = strings.TrimSpace(configDir)
	if configDir == "" {
		return errors.New("application config directory is empty")
	}
	iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
	return persistWindowsApplicationIconSelection(iconPath, iconDir)
}

func clearPersistedWindowsApplicationIcon(configDir string) error {
	configDir = strings.TrimSpace(configDir)
	if configDir == "" {
		return errors.New("application config directory is empty")
	}
	iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
	if err := os.MkdirAll(iconDir, 0o755); err != nil {
		return fmt.Errorf("create Windows application icon directory: %w", err)
	}
	return writeWindowsApplicationIconState("", iconDir)
}

func persistWindowsApplicationIconSelection(iconPath, iconDir string) error {
	cleanIconPath := filepath.Clean(iconPath)
	cleanIconDir := filepath.Clean(iconDir)
	iconName := filepath.Base(cleanIconPath)
	if iconName == "." || iconName == string(filepath.Separator) || filepath.Dir(cleanIconPath) != cleanIconDir {
		return errors.New("Windows application icon state path is not a direct icon file")
	}
	return writeWindowsApplicationIconState(iconName, iconDir)
}

func writeWindowsApplicationIconState(iconName, iconDir string) error {
	statePath := filepath.Join(iconDir, windowsApplicationIconStateFileName)
	temporary, err := os.CreateTemp(iconDir, ".gonavi-active-icon-*.tmp")
	if err != nil {
		return fmt.Errorf("create Windows application icon state: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.WriteString(iconName + "\n"); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write Windows application icon state: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync Windows application icon state: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close Windows application icon state: %w", err)
	}
	if err := os.Remove(statePath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("replace Windows application icon state: %w", err)
	}
	if err := os.Rename(temporaryPath, statePath); err != nil {
		return fmt.Errorf("commit Windows application icon state: %w", err)
	}
	return nil
}

func loadPersistedWindowsApplicationIcon(configDir string) (string, error) {
	configDir = strings.TrimSpace(configDir)
	if configDir == "" {
		return "", errors.New("application config directory is empty")
	}
	iconDir := filepath.Join(configDir, windowsApplicationIconDirectoryName)
	statePath := filepath.Join(iconDir, windowsApplicationIconStateFileName)
	data, err := os.ReadFile(statePath)
	if err == nil {
		iconName := strings.TrimSpace(string(data))
		if iconName == "" {
			return "", nil
		}
		if filepath.Base(iconName) == iconName && filepath.Ext(iconName) == ".ico" {
			iconPath := filepath.Join(iconDir, iconName)
			if info, statErr := os.Stat(iconPath); statErr == nil && info.Mode().IsRegular() {
				return iconPath, nil
			}
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return "", fmt.Errorf("read Windows application icon state: %w", err)
	}

	// Versions before the startup pointer was introduced already left
	// content-addressed ICO files behind. Pick the newest valid file once so
	// an existing user's selected icon is migrated without requiring a second
	// manual selection. New writes always create active-icon.txt and take
	// precedence above this compatibility fallback.
	entries, err := os.ReadDir(iconDir)
	if errors.Is(err, os.ErrNotExist) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("read Windows application icon directory: %w", err)
	}
	var newestPath string
	var newestModTime time.Time
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "gonavi-brand-") || filepath.Ext(entry.Name()) != ".ico" {
			continue
		}
		info, statErr := entry.Info()
		if statErr != nil || !info.Mode().IsRegular() {
			continue
		}
		if newestPath == "" || info.ModTime().After(newestModTime) ||
			(info.ModTime().Equal(newestModTime) && entry.Name() > filepath.Base(newestPath)) {
			newestPath = filepath.Join(iconDir, entry.Name())
			newestModTime = info.ModTime()
		}
	}
	return newestPath, nil
}
