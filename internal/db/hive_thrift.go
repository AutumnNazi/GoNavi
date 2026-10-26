//go:build gonavi_full_drivers || gonavi_hive_driver

package db

import (
	"bufio"
	"bytes"
	"context"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// Thrift Binary Protocol 常量定义（对应 Apache Thrift TBinaryProtocol 与 TSaslTransport）。
const (
	thriftVersionMask uint32 = 0xffff0000
	thriftVersion1    uint32 = 0x80010000

	thriftMsgCall      byte = 1
	thriftMsgReply     byte = 2
	thriftMsgException byte = 3

	thriftTypeStop   byte = 0
	thriftTypeVoid   byte = 1
	thriftTypeBool   byte = 2
	thriftTypeByte   byte = 3
	thriftTypeDouble byte = 4
	thriftTypeI16    byte = 6
	thriftTypeI32    byte = 8
	thriftTypeI64    byte = 10
	thriftTypeString byte = 11
	thriftTypeStruct byte = 12
	thriftTypeMap    byte = 13
	thriftTypeSet    byte = 14
	thriftTypeList   byte = 15

	saslStatusStart    byte = 1
	saslStatusOK       byte = 2
	saslStatusBad      byte = 3
	saslStatusError    byte = 4
	saslStatusComplete byte = 5

	maxThriftFrameBytes = 256 * 1024 * 1024
	maxThriftItemCount  = 16 * 1024 * 1024
)

// hiveTransport 封装 HiveServer2 的底层 TCP/TLS 连接，支持 SASL PLAIN 帧传输与 NOSASL 原始传输。
type hiveTransport struct {
	mu     sync.Mutex
	conn   net.Conn
	reader *bufio.Reader
	framed bool
	seqID  atomic.Int32
}

func newHiveTransport(conn net.Conn, framed bool) *hiveTransport {
	return &hiveTransport{
		conn:   conn,
		reader: bufio.NewReaderSize(conn, 64*1024),
		framed: framed,
	}
}

func (t *hiveTransport) Close() error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.conn == nil {
		return nil
	}
	err := t.conn.Close()
	t.conn = nil
	return err
}

// handshakeSASLPlain 执行 TSaslClientTransport 的 PLAIN 握手（适用 NONE / PLAIN / LDAP 认证）。
func (t *hiveTransport) handshakeSASLPlain(ctx context.Context, username, password string) error {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.conn == nil {
		return localizedDatabaseRuntimeError("db.backend.error.connection_not_open", nil)
	}
	stopWatch := watchContextDeadline(ctx, t.conn)
	defer stopWatch()

	user := strings.TrimSpace(username)
	if user == "" {
		user = "anonymous"
	}
	pass := password
	if pass == "" {
		pass = "anonymous"
	}

	var buf bytes.Buffer
	writeSASLMessage(&buf, saslStatusStart, []byte("PLAIN"))
	authPayload := make([]byte, 0, len(user)+len(pass)+2)
	authPayload = append(authPayload, 0)
	authPayload = append(authPayload, user...)
	authPayload = append(authPayload, 0)
	authPayload = append(authPayload, pass...)
	writeSASLMessage(&buf, saslStatusOK, authPayload)

	if _, err := t.conn.Write(buf.Bytes()); err != nil {
		return wrapHiveProtocolError(err)
	}

	for {
		status, payload, err := readSASLMessage(t.reader)
		if err != nil {
			return wrapHiveProtocolError(err)
		}
		switch status {
		case saslStatusComplete:
			return nil
		case saslStatusOK:
			// Challenge-response 后续轮次对 PLAIN 为空响应
			var next bytes.Buffer
			writeSASLMessage(&next, saslStatusOK, nil)
			if _, err := t.conn.Write(next.Bytes()); err != nil {
				return wrapHiveProtocolError(err)
			}
		case saslStatusBad, saslStatusError:
			detail := strings.TrimSpace(string(payload))
			if detail == "" {
				detail = fmt.Sprintf("SASL status %d", status)
			}
			return localizedDatabaseRuntimeError("db.backend.error.hive_auth_failed", map[string]any{"detail": detail})
		default:
			return wrapHiveProtocolError(fmt.Errorf("unexpected SASL negotiation status %d", status))
		}
	}
}

func writeSASLMessage(buf *bytes.Buffer, status byte, payload []byte) {
	buf.WriteByte(status)
	var lenBuf [4]byte
	binary.BigEndian.PutUint32(lenBuf[:], uint32(len(payload)))
	buf.Write(lenBuf[:])
	buf.Write(payload)
}

func readSASLMessage(r io.Reader) (byte, []byte, error) {
	var header [5]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return 0, nil, err
	}
	status := header[0]
	length := binary.BigEndian.Uint32(header[1:5])
	if length > maxThriftFrameBytes {
		return 0, nil, fmt.Errorf("SASL frame size %d exceeds limit", length)
	}
	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return 0, nil, err
		}
	}
	return status, payload, nil
}

// call 发送一次 Thrift RPC 请求并读取响应结构。
func (t *hiveTransport) call(ctx context.Context, method string, encodeArgs func(*hiveWriter), decodeResult func(*hiveReader) error) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.conn == nil {
		return localizedDatabaseRuntimeError("db.backend.error.connection_not_open", nil)
	}
	stopWatch := watchContextDeadline(ctx, t.conn)
	defer stopWatch()

	seq := t.seqID.Add(1)
	w := newHiveWriter()
	w.writeMessageBegin(method, thriftMsgCall, seq)
	encodeArgs(w)
	w.writeFieldStop()

	payload := w.bytes()
	if t.framed {
		var frameHdr [4]byte
		binary.BigEndian.PutUint32(frameHdr[:], uint32(len(payload)))
		if _, err := t.conn.Write(frameHdr[:]); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return err
		}
	}
	if _, err := t.conn.Write(payload); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return err
	}

	var r *hiveReader
	if t.framed {
		var frameHdr [4]byte
		if _, err := io.ReadFull(t.reader, frameHdr[:]); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return wrapHiveProtocolError(err)
		}
		frameLen := binary.BigEndian.Uint32(frameHdr[:])
		if frameLen > maxThriftFrameBytes {
			return wrapHiveProtocolError(fmt.Errorf("frame length %d exceeds limit", frameLen))
		}
		frame := make([]byte, frameLen)
		if _, err := io.ReadFull(t.reader, frame); err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			return wrapHiveProtocolError(err)
		}
		r = newHiveReader(bytes.NewReader(frame))
	} else {
		r = newHiveReader(t.reader)
	}

	_, msgType, _, err := r.readMessageBegin()
	if err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return wrapHiveProtocolError(err)
	}
	if msgType == thriftMsgException {
		appErr, exErr := r.readApplicationException()
		if exErr != nil {
			return wrapHiveProtocolError(exErr)
		}
		return appErr
	}
	if msgType != thriftMsgReply {
		return wrapHiveProtocolError(fmt.Errorf("unexpected Thrift message type %d", msgType))
	}
	return decodeResult(r)
}

func watchContextDeadline(ctx context.Context, conn net.Conn) func() {
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	} else {
		_ = conn.SetDeadline(time.Time{})
	}
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.SetDeadline(time.Now())
		case <-done:
		}
	}()
	return func() {
		close(done)
		_ = conn.SetDeadline(time.Time{})
	}
}

func wrapHiveProtocolError(err error) error {
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return localizedDatabaseRuntimeError("db.backend.error.hive_protocol_error", map[string]any{"detail": err.Error()})
}

// hiveWriter 编码 Thrift Binary 协议字节流。
type hiveWriter struct {
	buf bytes.Buffer
}

func newHiveWriter() *hiveWriter {
	return &hiveWriter{}
}

func (w *hiveWriter) bytes() []byte {
	return w.buf.Bytes()
}

func (w *hiveWriter) writeMessageBegin(name string, msgType byte, seqID int32) {
	w.writeI32(int32(thriftVersion1 | uint32(msgType)))
	w.writeString(name)
	w.writeI32(seqID)
}

func (w *hiveWriter) writeFieldBegin(fieldType byte, fieldID int16) {
	w.buf.WriteByte(fieldType)
	w.writeI16(fieldID)
}

func (w *hiveWriter) writeFieldStop() {
	w.buf.WriteByte(thriftTypeStop)
}

func (w *hiveWriter) writeBool(v bool) {
	if v {
		w.buf.WriteByte(1)
	} else {
		w.buf.WriteByte(0)
	}
}

func (w *hiveWriter) writeI16(v int16) {
	var b [2]byte
	binary.BigEndian.PutUint16(b[:], uint16(v))
	w.buf.Write(b[:])
}

func (w *hiveWriter) writeI32(v int32) {
	var b [4]byte
	binary.BigEndian.PutUint32(b[:], uint32(v))
	w.buf.Write(b[:])
}

func (w *hiveWriter) writeI64(v int64) {
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], uint64(v))
	w.buf.Write(b[:])
}

func (w *hiveWriter) writeDouble(v float64) {
	w.writeI64(int64(math.Float64bits(v)))
}

func (w *hiveWriter) writeString(s string) {
	w.writeI32(int32(len(s)))
	w.buf.WriteString(s)
}

func (w *hiveWriter) writeBytes(b []byte) {
	w.writeI32(int32(len(b)))
	w.buf.Write(b)
}

func (w *hiveWriter) writeStringMap(m map[string]string) {
	w.buf.WriteByte(thriftTypeString)
	w.buf.WriteByte(thriftTypeString)
	w.writeI32(int32(len(m)))
	for k, v := range m {
		w.writeString(k)
		w.writeString(v)
	}
}

// hiveReader 解码 Thrift Binary 协议字节流。
type hiveReader struct {
	r io.Reader
}

func newHiveReader(r io.Reader) *hiveReader {
	return &hiveReader{r: r}
}

func (r *hiveReader) readMessageBegin() (string, byte, int32, error) {
	sizeAndVersion, err := r.readI32()
	if err != nil {
		return "", 0, 0, err
	}
	u := uint32(sizeAndVersion)
	if (u & thriftVersionMask) != thriftVersion1 {
		return "", 0, 0, fmt.Errorf("unsupported Thrift binary version 0x%x", u)
	}
	msgType := byte(u & 0x000000ff)
	name, err := r.readString()
	if err != nil {
		return "", 0, 0, err
	}
	seqID, err := r.readI32()
	if err != nil {
		return "", 0, 0, err
	}
	return name, msgType, seqID, nil
}

func (r *hiveReader) readFieldBegin() (byte, int16, error) {
	fieldType, err := r.readByte()
	if err != nil {
		return 0, 0, err
	}
	if fieldType == thriftTypeStop {
		return thriftTypeStop, 0, nil
	}
	fieldID, err := r.readI16()
	if err != nil {
		return 0, 0, err
	}
	return fieldType, fieldID, nil
}

func (r *hiveReader) readByte() (byte, error) {
	var b [1]byte
	if _, err := io.ReadFull(r.r, b[:]); err != nil {
		return 0, err
	}
	return b[0], nil
}

func (r *hiveReader) readBool() (bool, error) {
	b, err := r.readByte()
	return b != 0, err
}

func (r *hiveReader) readI16() (int16, error) {
	var b [2]byte
	if _, err := io.ReadFull(r.r, b[:]); err != nil {
		return 0, err
	}
	return int16(binary.BigEndian.Uint16(b[:])), nil
}

func (r *hiveReader) readI32() (int32, error) {
	var b [4]byte
	if _, err := io.ReadFull(r.r, b[:]); err != nil {
		return 0, err
	}
	return int32(binary.BigEndian.Uint32(b[:])), nil
}

func (r *hiveReader) readI64() (int64, error) {
	var b [8]byte
	if _, err := io.ReadFull(r.r, b[:]); err != nil {
		return 0, err
	}
	return int64(binary.BigEndian.Uint64(b[:])), nil
}

func (r *hiveReader) readDouble() (float64, error) {
	bits, err := r.readI64()
	if err != nil {
		return 0, err
	}
	return math.Float64frombits(uint64(bits)), nil
}

func (r *hiveReader) readBytes() ([]byte, error) {
	size, err := r.readI32()
	if err != nil {
		return nil, err
	}
	if size < 0 || size > maxThriftFrameBytes {
		return nil, fmt.Errorf("invalid Thrift binary length %d", size)
	}
	if size == 0 {
		return []byte{}, nil
	}
	buf := make([]byte, size)
	if _, err := io.ReadFull(r.r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func (r *hiveReader) readString() (string, error) {
	b, err := r.readBytes()
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func (r *hiveReader) readListBegin() (byte, int, error) {
	elemType, err := r.readByte()
	if err != nil {
		return 0, 0, err
	}
	size, err := r.readI32()
	if err != nil {
		return 0, 0, err
	}
	if size < 0 || size > maxThriftItemCount {
		return 0, 0, fmt.Errorf("invalid Thrift list size %d", size)
	}
	return elemType, int(size), nil
}

func (r *hiveReader) readMapBegin() (byte, byte, int, error) {
	keyType, err := r.readByte()
	if err != nil {
		return 0, 0, 0, err
	}
	valType, err := r.readByte()
	if err != nil {
		return 0, 0, 0, err
	}
	size, err := r.readI32()
	if err != nil {
		return 0, 0, 0, err
	}
	if size < 0 || size > maxThriftItemCount {
		return 0, 0, 0, fmt.Errorf("invalid Thrift map size %d", size)
	}
	return keyType, valType, int(size), nil
}

func (r *hiveReader) skip(fieldType byte) error {
	switch fieldType {
	case thriftTypeBool, thriftTypeByte:
		_, err := r.readByte()
		return err
	case thriftTypeI16:
		_, err := r.readI16()
		return err
	case thriftTypeI32:
		_, err := r.readI32()
		return err
	case thriftTypeI64, thriftTypeDouble:
		_, err := r.readI64()
		return err
	case thriftTypeString:
		_, err := r.readBytes()
		return err
	case thriftTypeStruct:
		for {
			ft, _, err := r.readFieldBegin()
			if err != nil {
				return err
			}
			if ft == thriftTypeStop {
				return nil
			}
			if err := r.skip(ft); err != nil {
				return err
			}
		}
	case thriftTypeMap:
		kt, vt, size, err := r.readMapBegin()
		if err != nil {
			return err
		}
		for i := 0; i < size; i++ {
			if err := r.skip(kt); err != nil {
				return err
			}
			if err := r.skip(vt); err != nil {
				return err
			}
		}
		return nil
	case thriftTypeList, thriftTypeSet:
		et, size, err := r.readListBegin()
		if err != nil {
			return err
		}
		for i := 0; i < size; i++ {
			if err := r.skip(et); err != nil {
				return err
			}
		}
		return nil
	default:
		return fmt.Errorf("unknown Thrift field type %d", fieldType)
	}
}

func (r *hiveReader) readApplicationException() (error, error) {
	var msg string
	var exType int32
	for {
		ft, fid, err := r.readFieldBegin()
		if err != nil {
			return nil, err
		}
		if ft == thriftTypeStop {
			break
		}
		switch {
		case fid == 1 && ft == thriftTypeString:
			if msg, err = r.readString(); err != nil {
				return nil, err
			}
		case fid == 2 && ft == thriftTypeI32:
			if exType, err = r.readI32(); err != nil {
				return nil, err
			}
		default:
			if err := r.skip(ft); err != nil {
				return nil, err
			}
		}
	}
	if strings.TrimSpace(msg) == "" {
		msg = fmt.Sprintf("Thrift application exception (type %d)", exType)
	}
	return errors.New(msg), nil
}
