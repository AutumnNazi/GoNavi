package connection

import (
	"bytes"
	"errors"
	"io"
	"net"
	"strconv"
	"testing"
	"time"
)

// localMessageConn uses loopback only; no InterSystems server or credentials.
func localMessageConn(t *testing.T) (*net.TCPConn, *net.TCPConn) {
	t.Helper()
	listener, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	client, err := net.DialTCP("tcp", nil, listener.Addr().(*net.TCPAddr))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { client.Close() })
	server, err := listener.AcceptTCP()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { server.Close() })
	return client, server
}

func responseFrame(payload []byte, status uint16) []byte {
	msg := NewMessage(MessageType(string([]byte{byte(status), byte(status >> 8)})))
	msg.AddRaw(payload)
	return msg.Dump(1)
}

func TestReadMessageFrames(t *testing.T) {
	for _, test := range []struct {
		name     string
		payload  []byte
		fragment bool
	}{
		{name: "empty terminal frame"},
		{name: "fragmented header", payload: []byte("table metadata"), fragment: true},
		{name: "complete frame", payload: []byte("table metadata")},
	} {
		t.Run(test.name, func(t *testing.T) {
			client, server := localMessageConn(t)
			frame := responseFrame(test.payload, 100)
			done := make(chan error, 1) // One writer result, joined below.
			go func() {
				if test.fragment {
					if _, err := server.Write(frame[:4]); err != nil {
						done <- err
						return
					}
					time.Sleep(20 * time.Millisecond)
					frame = frame[4:]
				}
				_, err := server.Write(frame)
				done <- err
			}()
			msg, err := ReadMessageWithTimeout(client, 300*time.Millisecond)
			if writeErr := <-done; writeErr != nil {
				t.Fatal(writeErr)
			}
			if err != nil {
				t.Fatalf("complete response must not wait for another frame: %v", err)
			}
			if msg.GetStatus() != 100 || !bytes.Equal(msg.data, test.payload) {
				t.Fatalf("frame corrupted: status=%d payload=%q", msg.GetStatus(), msg.data)
			}
		})
	}
}

func TestReadMessageTruncated(t *testing.T) {
	for _, size := range []int{4, 16} {
		t.Run(strconv.Itoa(size), func(t *testing.T) {
			client, server := localMessageConn(t)
			frame := responseFrame([]byte("metadata"), 100)
			if _, err := server.Write(frame[:size]); err != nil {
				t.Fatal(err)
			}
			if err := server.CloseWrite(); err != nil {
				t.Fatal(err)
			}
			_, err := ReadMessageWithTimeout(client, time.Second)
			if !errors.Is(err, io.ErrUnexpectedEOF) {
				t.Fatalf("truncated frame must fail, got %v", err)
			}
		})
	}
}

func TestFetchMoreDataEmptyTerminalFrame(t *testing.T) {
	client, server := localMessageConn(t)
	rs := &ResultSet{c: &Connection{conn: client, queryTimeout: 300 * time.Millisecond}, stmtId: 7}
	done := make(chan error, 1) // One simulated server result, joined below.
	go func() {
		_, err := ReadMessageWithTimeout(server, time.Second)
		if err == nil {
			_, err = server.Write(responseFrame(nil, 100))
		}
		done <- err
	}()
	_, err := rs.Next()
	if serverErr := <-done; serverErr != nil {
		t.Fatal(serverErr)
	}
	if !errors.Is(err, io.EOF) {
		t.Fatalf("terminal metadata fetch must end immediately, got %v", err)
	}
}
