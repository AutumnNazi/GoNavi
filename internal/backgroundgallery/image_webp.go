package backgroundgallery

import "encoding/binary"

const webPAlphaFlag = 0x10

func isWebP(payload []byte) bool {
	return len(payload) >= 12 && string(payload[:4]) == "RIFF" && string(payload[8:12]) == "WEBP"
}

// staticWebPDimensions validates allocation-driving headers without decoding pixels.
// Only simple VP8/VP8L and static VP8X (optionally alpha) are supported. Metadata,
// unknown chunks and animation are deliberately rejected, not silently ignored.
func staticWebPDimensions(payload []byte) (int, int, bool) {
	if !isWebP(payload) || len(payload) > maxImageBytes || uint64(binary.LittleEndian.Uint32(payload[4:8]))+8 != uint64(len(payload)) {
		return 0, 0, false
	}
	kind, frame, rest, ok := readWebPChunk(payload[12:])
	if !ok {
		return 0, 0, false
	}
	extended := kind == "VP8X"
	var canvasWidth, canvasHeight int
	var wantAlpha, hasAlpha bool
	if extended {
		if len(frame) != 10 || frame[0] & ^byte(webPAlphaFlag) != 0 || frame[1] != 0 || frame[2] != 0 || frame[3] != 0 {
			return 0, 0, false
		}
		canvasWidth, canvasHeight = webPUint24(frame[4:7])+1, webPUint24(frame[7:10])+1
		if int64(canvasWidth)*int64(canvasHeight) > maxPixels {
			return 0, 0, false
		}
		wantAlpha = frame[0]&webPAlphaFlag != 0
		kind, frame, rest, ok = readWebPChunk(rest)
		if !ok {
			return 0, 0, false
		}
		if kind == "ALPH" {
			if !wantAlpha || !validWebPAlpha(frame, canvasWidth, canvasHeight) {
				return 0, 0, false
			}
			hasAlpha = true
			kind, frame, rest, ok = readWebPChunk(rest)
			if !ok {
				return 0, 0, false
			}
		}
	}
	// Exactly one image frame must consume the entire RIFF container.
	if len(rest) != 0 {
		return 0, 0, false
	}
	width, height, losslessAlpha, ok := webPFrameDimensions(kind, frame)
	if !ok || width < 1 || height < 1 || int64(width)*int64(height) > maxPixels {
		return 0, 0, false
	}
	if hasAlpha && kind != "VP8 " {
		return 0, 0, false
	}
	if extended && (width != canvasWidth || height != canvasHeight || wantAlpha != (hasAlpha || losslessAlpha)) {
		return 0, 0, false
	}
	return width, height, true
}

func readWebPChunk(payload []byte) (string, []byte, []byte, bool) {
	if len(payload) < 8 {
		return "", nil, nil, false
	}
	// Widen before adding padding so 0xffffffff cannot wrap into a small chunk.
	size := uint64(binary.LittleEndian.Uint32(payload[4:8]))
	end := uint64(8) + size
	paddedEnd := end + size%2
	if paddedEnd > uint64(len(payload)) || size%2 != 0 && payload[int(end)] != 0 {
		return "", nil, nil, false
	}
	return string(payload[:4]), payload[8:int(end)], payload[int(paddedEnd):], true
}

func webPUint24(payload []byte) int {
	return int(payload[0]) | int(payload[1])<<8 | int(payload[2])<<16
}

func webPFrameDimensions(kind string, frame []byte) (int, int, bool, bool) {
	switch kind {
	case "VP8 ":
		if len(frame) < 10 || frame[0]&1 != 0 || frame[0]&0x10 == 0 || (frame[0]>>1)&7 > 3 || string(frame[3:6]) != "\x9d\x01\x2a" {
			return 0, 0, false, false
		}
		if frame[7]&0xc0 != 0 || frame[9]&0xc0 != 0 || webPUint24(frame[:3])>>5 > len(frame)-10 {
			return 0, 0, false, false
		}
		return int(binary.LittleEndian.Uint16(frame[6:8])), int(binary.LittleEndian.Uint16(frame[8:10])), false, true
	case "VP8L":
		if len(frame) < 5 || frame[0] != 0x2f || frame[4]&0xe0 != 0 {
			return 0, 0, false, false
		}
		bits := binary.LittleEndian.Uint32(frame[1:5])
		return int(bits&0x3fff) + 1, int((bits>>14)&0x3fff) + 1, bits&(1<<28) != 0, true
	default:
		return 0, 0, false, false
	}
}

func validWebPAlpha(frame []byte, width, height int) bool {
	if len(frame) < 2 || frame[0]&0xc0 != 0 || (frame[0]>>4)&3 > 1 || frame[0]&3 > 1 {
		return false
	}
	if frame[0]&3 == 0 {
		return int64(len(frame)-1) == int64(width)*int64(height)
	}
	// The decoder synthesizes a 14-bit VP8L header for compressed alpha.
	return width <= 1<<14 && height <= 1<<14
}
