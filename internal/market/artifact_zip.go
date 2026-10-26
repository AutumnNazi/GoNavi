package market

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"io/fs"
	"sort"
)

func (index *artifactIndex) readZIP(ctx context.Context, data []byte) error {
	if err := preflightArtifactZIP(ctx, data); err != nil {
		return err
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return fmt.Errorf("read zip directory: %w", err)
	}
	for _, file := range zr.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		mode := file.Mode()
		if mode.Type() != 0 && mode.Type() != fs.ModeDir {
			return fmt.Errorf("zip entry is a link or special file")
		}
		if file.Flags & ^uint16(0x080e) != 0 || (file.Method != zip.Store && file.Method != zip.Deflate) {
			return fmt.Errorf("encrypted or unsupported zip entry")
		}
		if file.UncompressedSize64 > maxArtifactExpandedBytes {
			return fmt.Errorf("zip entry exceeds expanded size limit")
		}
		size := int64(file.UncompressedSize64)
		if err := index.add(file.Name, mode.IsDir(), size); err != nil {
			return err
		}
		entry, err := file.Open()
		if err != nil {
			return fmt.Errorf("open zip entry: %w", err)
		}
		readErr := index.readEntry(ctx, file.Name, size, entry)
		closeErr := entry.Close()
		if readErr != nil {
			return readErr
		}
		if closeErr != nil {
			return fmt.Errorf("close zip entry: %w", closeErr)
		}
	}
	return nil
}

// Count actual central records before archive/zip allocates its directory. ZIP64,
// split archives, executable prefixes, and bytes after EOCD are deliberately denied.
func preflightArtifactZIP(ctx context.Context, data []byte) error {
	end := -1
	for offset := len(data) - 22; offset >= 0 && offset >= len(data)-65557; offset-- {
		if binary.LittleEndian.Uint32(data[offset:]) == 0x06054b50 &&
			offset+22+int(binary.LittleEndian.Uint16(data[offset+20:])) == len(data) {
			end = offset
			break
		}
	}
	if end < 0 {
		return fmt.Errorf("zip end directory is missing or malformed")
	}
	header := data[end:]
	count := int(binary.LittleEndian.Uint16(header[10:]))
	if binary.LittleEndian.Uint16(header[4:]) != 0 || binary.LittleEndian.Uint16(header[6:]) != 0 ||
		int(binary.LittleEndian.Uint16(header[8:])) != count || count > maxArtifactFiles {
		return fmt.Errorf("split, zip64, or excessive zip directory")
	}
	start := int64(binary.LittleEndian.Uint32(header[16:]))
	size := int64(binary.LittleEndian.Uint32(header[12:]))
	if start+size != int64(end) || start < 0 || start > int64(end) {
		return fmt.Errorf("invalid zip directory bounds or unsupported zip64")
	}
	actual := 0
	spans := make([]artifactZIPSpan, 0, count)
	for offset := int(start); offset < end; {
		if err := ctx.Err(); err != nil {
			return err
		}
		actual++
		if actual > maxArtifactFiles || offset+46 > end || binary.LittleEndian.Uint32(data[offset:]) != 0x02014b50 {
			return fmt.Errorf("invalid or excessive zip directory records")
		}
		record := data[offset:]
		length := 46 + int(binary.LittleEndian.Uint16(record[28:])) +
			int(binary.LittleEndian.Uint16(record[30:])) + int(binary.LittleEndian.Uint16(record[32:]))
		if offset+length > end || binary.LittleEndian.Uint16(record[34:]) != 0 {
			return fmt.Errorf("invalid zip central record")
		}
		span, err := checkArtifactZIPLocal(data[:start], record[:length])
		if err != nil {
			return err
		}
		spans = append(spans, span)
		offset += length
	}
	if actual != count || (actual > 0 && binary.LittleEndian.Uint32(data) != 0x04034b50) {
		return fmt.Errorf("zip entry count mismatch or executable prefix")
	}
	sort.Slice(spans, func(i, j int) bool { return spans[i].start < spans[j].start })
	var position int64
	for _, span := range spans {
		if span.start != position {
			return fmt.Errorf("zip has overlapping entries or unlisted data")
		}
		position = span.end
	}
	if position != start {
		return fmt.Errorf("zip contains data outside listed entries")
	}
	return nil
}

type artifactZIPSpan struct {
	start int64
	end   int64
}

func checkArtifactZIPLocal(body, central []byte) (artifactZIPSpan, error) {
	offset := int64(binary.LittleEndian.Uint32(central[42:]))
	if offset+30 > int64(len(body)) || binary.LittleEndian.Uint32(body[offset:]) != 0x04034b50 {
		return artifactZIPSpan{}, fmt.Errorf("invalid zip local header")
	}
	local := body[offset:]
	nameLength := int64(binary.LittleEndian.Uint16(local[26:]))
	extraLength := int64(binary.LittleEndian.Uint16(local[28:]))
	compressed := int64(binary.LittleEndian.Uint32(central[20:]))
	if offset+30+nameLength+extraLength+compressed > int64(len(body)) ||
		binary.LittleEndian.Uint16(local[6:]) != binary.LittleEndian.Uint16(central[8:]) ||
		binary.LittleEndian.Uint16(local[8:]) != binary.LittleEndian.Uint16(central[10:]) {
		return artifactZIPSpan{}, fmt.Errorf("zip local header disagrees with central directory")
	}
	centralNameLength := int(binary.LittleEndian.Uint16(central[28:]))
	if !bytes.Equal(local[30:30+nameLength], central[46:46+centralNameLength]) {
		return artifactZIPSpan{}, fmt.Errorf("zip local entry name disagrees with central directory")
	}
	if err := checkArtifactZIPExtra(local[30+nameLength : 30+nameLength+extraLength]); err != nil {
		return artifactZIPSpan{}, err
	}
	extraEnd := 46 + centralNameLength + int(binary.LittleEndian.Uint16(central[30:]))
	if err := checkArtifactZIPExtra(central[46+centralNameLength : extraEnd]); err != nil {
		return artifactZIPSpan{}, err
	}
	descriptor := binary.LittleEndian.Uint16(local[6:])&8 != 0
	for _, field := range [][2]int{{14, 16}, {18, 20}, {22, 24}} {
		value := binary.LittleEndian.Uint32(local[field[0]:])
		expected := binary.LittleEndian.Uint32(central[field[1]:])
		if value != expected && (!descriptor || value != 0) {
			return artifactZIPSpan{}, fmt.Errorf("zip local checksum or size disagrees with directory")
		}
	}
	end := offset + 30 + nameLength + extraLength + compressed
	if descriptor {
		var err error
		end, err = checkArtifactZIPDescriptor(body, central, end)
		if err != nil {
			return artifactZIPSpan{}, err
		}
	}
	return artifactZIPSpan{start: offset, end: end}, nil
}

func checkArtifactZIPDescriptor(body, central []byte, offset int64) (int64, error) {
	if offset+4 <= int64(len(body)) && binary.LittleEndian.Uint32(body[offset:]) == 0x08074b50 {
		offset += 4
	}
	if offset+12 > int64(len(body)) || !bytes.Equal(body[offset:offset+12], central[16:28]) {
		return 0, fmt.Errorf("invalid zip data descriptor")
	}
	return offset + 12, nil
}

func checkArtifactZIPExtra(extra []byte) error {
	for len(extra) > 0 {
		if len(extra) < 4 {
			return fmt.Errorf("malformed zip extra field")
		}
		id := binary.LittleEndian.Uint16(extra)
		size := int(binary.LittleEndian.Uint16(extra[2:]))
		// UNIX/ASi fields can carry link targets or device metadata. ZIP64 is
		// unnecessary for bounded packages and makes local sizes ambiguous.
		if size > len(extra)-4 || id == 0x0001 || id == 0x000d || id == 0x756e {
			return fmt.Errorf("unsupported or malformed zip extra field")
		}
		extra = extra[4+size:]
	}
	return nil
}
