package plugin

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/binary"
	"fmt"
	"io"
	"os"
	"strings"
)

func archiveFormat(source string) (string, error) {
	f, err := os.Open(source)
	if err != nil {
		return "", err
	}
	defer f.Close()
	header := make([]byte, 4)
	if _, err = io.ReadFull(f, header); err != nil {
		return "", fmt.Errorf("read package header: %w", err)
	}
	if header[0] == 0x50 && header[1] == 0x4b && (header[2] == 3 || header[2] == 5) && header[3] == header[2]+1 {
		return "zip", nil
	}
	if header[0] == 0x1f && header[1] == 0x8b {
		return "tgz", nil
	}
	return "", fmt.Errorf("unsupported package format")
}

func (s *packageScan) zip(source string) error {
	if err := preflightZIP(source); err != nil {
		return err
	}
	archive, err := zip.OpenReader(source)
	if err != nil {
		return fmt.Errorf("open zip: %w", err)
	}
	defer archive.Close()
	if len(archive.File) > maxPackageEntries {
		return fmt.Errorf("zip contains too many entries")
	}
	for _, entry := range archive.File {
		if entry.Mode().IsDir() {
			if err = s.entry(strings.TrimSuffix(entry.Name, "/"), true); err != nil {
				return err
			}
			continue
		}
		if !entry.Mode().IsRegular() {
			return fmt.Errorf("zip contains link or special file")
		}
		if entry.UncompressedSize64 > uint64(maxFileBytes) {
			return fmt.Errorf("zip file exceeds size limit")
		}
		r, err := entry.Open()
		if err != nil {
			return err
		}
		scanErr := s.file(entry.Name, int64(entry.UncompressedSize64), r)
		closeErr := r.Close()
		if scanErr != nil {
			return scanErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

// preflightZIP bounds allocation before archive/zip parses its central directory.
// ZIP64/multidisk archives are unnecessary within the conservative package limits.
func preflightZIP(source string) error {
	f, err := os.Open(source)
	if err != nil {
		return err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		return err
	}
	length := info.Size()
	if length > 65557 {
		length = 65557
	}
	if length < 22 {
		return fmt.Errorf("invalid zip footer")
	}
	tail := make([]byte, int(length))
	if _, err = f.ReadAt(tail, info.Size()-length); err != nil {
		return err
	}
	for index := len(tail) - 22; index >= 0; index-- {
		if binary.LittleEndian.Uint32(tail[index:]) != 0x06054b50 {
			continue
		}
		footer := tail[index:]
		if int(binary.LittleEndian.Uint16(footer[20:]))+22 != len(footer) {
			continue
		}
		count := binary.LittleEndian.Uint16(footer[10:])
		size := binary.LittleEndian.Uint32(footer[12:])
		if binary.LittleEndian.Uint16(footer[4:]) != 0 || binary.LittleEndian.Uint16(footer[6:]) != 0 || binary.LittleEndian.Uint16(footer[8:]) != count || count > maxPackageEntries || size > 8<<20 || binary.LittleEndian.Uint32(footer[16:]) == 0xffffffff {
			return fmt.Errorf("zip directory exceeds limits or uses unsupported layout")
		}
		return validateZIPDirectory(f, int64(binary.LittleEndian.Uint32(footer[16:])), int64(size), int(count), info.Size()-length+int64(index))
	}
	return fmt.Errorf("invalid zip footer")
}

func validateZIPDirectory(f *os.File, offset, size int64, count int, end int64) error {
	if offset < 0 || size < 0 || offset+size != end {
		return fmt.Errorf("unsupported zip directory offsets")
	}
	reader := io.NewSectionReader(f, offset, size)
	header := make([]byte, 46)
	consumed := int64(0)
	actual := 0
	for consumed < size {
		if _, err := io.ReadFull(reader, header); err != nil {
			return fmt.Errorf("truncated zip directory: %w", err)
		}
		if binary.LittleEndian.Uint32(header) != 0x02014b50 {
			return fmt.Errorf("invalid zip directory entry")
		}
		actual++
		if actual > maxPackageEntries {
			return fmt.Errorf("zip contains too many directory records")
		}
		if binary.LittleEndian.Uint32(header[24:]) > uint32(maxFileBytes) || binary.LittleEndian.Uint16(header[34:]) != 0 || binary.LittleEndian.Uint16(header[8:])&1 != 0 {
			return fmt.Errorf("zip entry exceeds limits or is encrypted")
		}
		skip := int64(binary.LittleEndian.Uint16(header[28:])) + int64(binary.LittleEndian.Uint16(header[30:])) + int64(binary.LittleEndian.Uint16(header[32:]))
		consumed += 46 + skip
		if consumed > size {
			return fmt.Errorf("invalid zip directory record length")
		}
		if _, err := reader.Seek(skip, io.SeekCurrent); err != nil {
			return err
		}
	}
	if actual != count {
		return fmt.Errorf("zip directory count mismatch")
	}
	return nil
}

func (s *packageScan) tgz(source string) error {
	f, err := os.Open(source)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(contextReader{ctx: s.ctx, reader: f})
	if err != nil {
		return fmt.Errorf("open gzip: %w", err)
	}
	defer gz.Close()
	// Count TAR overhead too: malicious padding/PAX records must not inflate forever.
	limited := &io.LimitedReader{R: gz, N: maxPackageBytes + (16 << 20)}
	archive := tar.NewReader(limited)
	for {
		entry, err := archive.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return fmt.Errorf("read tar: %w", err)
		}
		switch entry.Typeflag {
		case tar.TypeDir:
			err = s.entry(strings.TrimSuffix(entry.Name, "/"), true)
		case tar.TypeReg, tar.TypeRegA:
			err = s.file(entry.Name, entry.Size, archive)
		default:
			return fmt.Errorf("tar contains link or unsupported entry")
		}
		if err != nil {
			return err
		}
	}
	if limited.N <= 0 {
		return fmt.Errorf("tar exceeds inflated size limit")
	}
	// Consume the bounded remainder to validate the gzip checksum and reject bombs in trailing data.
	if _, err = io.Copy(io.Discard, limited); err != nil {
		return fmt.Errorf("verify gzip: %w", err)
	}
	if limited.N <= 0 {
		return fmt.Errorf("gzip exceeds inflated size limit")
	}
	return nil
}
