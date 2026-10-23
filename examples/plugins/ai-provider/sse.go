package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"io"
	"unicode/utf8"

	plugin "github.com/Syngnat/GoNavi/sdk/go"
)

const (
	maxBodyBytes  = 16 << 20
	maxLineBytes  = 128 << 10
	maxEventBytes = 128 << 10
)

type bodyReader struct {
	source    io.Reader
	remaining int
}

func (r *bodyReader) Read(target []byte) (int, error) {
	if len(target) > r.remaining+1 {
		target = target[:r.remaining+1]
	}
	n, err := r.source.Read(target)
	if n > r.remaining {
		return 0, failure("limit_exceeded")
	}
	r.remaining -= n
	return n, err
}

type sseReader struct {
	reader    *bufio.Reader
	skipLF    bool
	firstLine bool
	endSeen   bool
}

func (r *sseReader) line(ctx context.Context) ([]byte, error) {
	line := make([]byte, 0, 256)
	for {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		value, err := r.reader.ReadByte()
		if err != nil {
			if errors.Is(err, io.EOF) && len(line) > 0 {
				return nil, failure("generation_failed")
			}
			return nil, err
		}
		if r.skipLF {
			r.skipLF = false
			if value == '\n' {
				continue
			}
		}
		if value == '\r' || value == '\n' {
			r.skipLF = value == '\r'
			if !utf8.Valid(line) {
				return nil, failure("generation_failed")
			}
			return line, nil
		}
		if len(line) == maxLineBytes {
			return nil, failure("limit_exceeded")
		}
		line = append(line, value)
	}
}

func (r *sseReader) event(ctx context.Context) ([]byte, error) {
	var data []byte
	hasData := false
	eventBytes := 0
	for {
		line, err := r.line(ctx)
		if err != nil {
			if errors.Is(err, io.EOF) && eventBytes > 0 {
				return nil, failure("generation_failed")
			}
			return nil, err
		}
		if r.firstLine {
			// The SSE grammar permits one UTF-8 byte order mark at the start only.
			line = bytes.TrimPrefix(line, []byte("\xef\xbb\xbf"))
			r.firstLine = false
		}
		if len(line) == 0 {
			if hasData {
				return data, nil
			}
			eventBytes = 0
			continue
		}
		eventBytes += len(line) + 1
		if eventBytes > maxEventBytes {
			return nil, failure("limit_exceeded")
		}
		if line[0] == ':' {
			continue
		}
		if r.endSeen {
			return nil, failure("generation_failed")
		}
		field, value, _ := bytes.Cut(line, []byte(":"))
		if !bytes.Equal(field, []byte("data")) {
			continue
		}
		value = bytes.TrimPrefix(value, []byte(" "))
		if hasData {
			data = append(data, '\n')
		}
		data = append(data, value...)
		hasData = true
	}
}

func readCompletion(ctx context.Context, source io.Reader, emit plugin.AIProviderEmit) (plugin.AIProviderCompletion, error) {
	reader := sseReader{reader: bufio.NewReader(&bodyReader{source: source, remaining: maxBodyBytes}), firstLine: true}
	state := streamState{}
	for {
		event, err := reader.event(ctx)
		if errors.Is(err, io.EOF) && state.done {
			return state.completion()
		}
		if err != nil {
			var safe *plugin.AIProviderFailure
			if errors.As(err, &safe) {
				return plugin.AIProviderCompletion{}, safe
			}
			return plugin.AIProviderCompletion{}, failure("generation_failed")
		}
		if err = state.accept(event, emit); err != nil {
			return plugin.AIProviderCompletion{}, err
		}
		reader.endSeen = state.done
	}
}
