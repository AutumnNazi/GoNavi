package connection

import (
	"errors"
	"io"
	"net"
	"testing"
	"time"
)

func emptyColumnsFrame(featureSupported bool) []byte {
	msg := NewMessage(MessageType("\x00\x00"))
	if featureSupported {
		msg.Set(0) // statement feature
	}
	msg.Set(0) // columns
	msg.Set(0) // parameter count
	msg.Set(0) // parameter flag
	return msg.Dump(1)
}

func TestDirectQueryResponseFrames(t *testing.T) {
	for _, featureSupported := range []bool{false, true} {
		for _, test := range []struct {
			name     string
			prefix   int
			terminal bool
		}{
			{name: "legal empty terminal", terminal: true},
			{name: "legacy no frame"},
			{name: "partial header timeout", prefix: 4},
			{name: "partial payload timeout", prefix: 15},
		} {
			protocol := "cache"
			if featureSupported {
				protocol = "iris"
			}
			t.Run(protocol+"/"+test.name, func(t *testing.T) {
				client, server := localMessageConn(t)
				c := &Connection{conn: client, queryTimeout: 60 * time.Millisecond, featureOptionSupported: featureSupported}
				done := make(chan error, 1) // One simulated server result, joined below.
				go func() {
					_, err := ReadMessageWithTimeout(server, time.Second)
					if err == nil {
						_, err = server.Write(emptyColumnsFrame(featureSupported))
					}
					if err == nil && test.terminal {
						_, err = server.Write(responseFrame(nil, 100))
					}
					if err == nil && test.prefix > 0 {
						_, err = server.Write(responseFrame([]byte("row"), 100)[:test.prefix])
					}
					done <- err
				}()
				rs, err := c.DirectQuery("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES")
				if serverErr := <-done; serverErr != nil {
					t.Fatal(serverErr)
				}
				if test.prefix > 0 {
					var networkError net.Error
					if !errors.Is(err, errIncompleteMessage) || !errors.As(err, &networkError) || !networkError.Timeout() {
						t.Fatalf("partial frame must report timeout, not successful empty data: %v", err)
					}
					if _, writeErr := client.Write([]byte("next query")); writeErr == nil {
						t.Fatal("desynchronized socket remains reusable")
					}
					return
				}
				if !test.terminal {
					var networkError net.Error
					if !errors.As(err, &networkError) || !networkError.Timeout() {
						t.Fatalf("missing terminal frame must report timeout: %v", err)
					}
					if _, writeErr := client.Write([]byte("next query")); writeErr == nil {
						t.Fatal("socket with missing terminal frame remains reusable")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}

				if _, err := rs.Next(); !errors.Is(err, io.EOF) {
					t.Fatalf("expected empty result, got %v", err)
				}
			})
		}
	}
}

func TestReadMessageDelayedPayload(t *testing.T) {
	client, server := localMessageConn(t)
	frame := responseFrame([]byte("slow metadata"), 100)
	done := make(chan error, 1) // One simulated server result, joined below.
	go func() {
		_, err := server.Write(frame[:14])
		if err == nil {
			time.Sleep(30 * time.Millisecond)
			_, err = server.Write(frame[14:])
		}
		done <- err
	}()
	msg, err := ReadMessageWithTimeout(client, time.Second)
	if serverErr := <-done; serverErr != nil {
		t.Fatal(serverErr)
	}
	if err != nil || string(msg.data) != "slow metadata" {
		t.Fatalf("slow frame lost: data=%q err=%v", msg.data, err)
	}
}

func TestDirectQueryDelayedDataFrame(t *testing.T) {
	for _, featureSupported := range []bool{false, true} {
		protocol := "cache"
		if featureSupported {
			protocol = "iris"
		}
		t.Run(protocol, func(t *testing.T) {
			testDirectQueryDelayedDataFrame(t, featureSupported)
		})
	}
}

func testDirectQueryDelayedDataFrame(t *testing.T, featureSupported bool) {
	t.Helper()
	client, server := localMessageConn(t)
	c := &Connection{conn: client, queryTimeout: 5 * time.Second, featureOptionSupported: featureSupported}
	done := make(chan error, 1) // Join the one simulated response sender.
	go func() {
		_, err := ReadMessageWithTimeout(server, time.Second)
		if err == nil {
			_, err = server.Write(emptyColumnsFrame(featureSupported))
		}
		if err == nil {
			time.Sleep(2100 * time.Millisecond) // Exceed the removed two-second empty-result heuristic.
			_, err = server.Write(responseFrame([]byte("delayed row"), 100))
		}
		done <- err
	}()
	rs, err := c.DirectQuery("SELECT 42")
	if serverErr := <-done; serverErr != nil {
		t.Fatal(serverErr)
	}
	if err != nil {
		t.Fatal(err)
	}
	if string(rs.data) != "delayed row" {
		t.Fatalf("delayed data silently lost: %q", rs.data)
	}
}
