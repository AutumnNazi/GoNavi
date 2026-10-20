package redis

import (
	"bufio"
	"context"
	"errors"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"GoNavi-Wails/internal/connection"
)

func TestRedisRawCommandDoesNotReplayLostWriteResponse(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	var writes atomic.Int32
	var workers sync.WaitGroup
	stopped := make(chan struct{})
	go func() {
		defer close(stopped)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			workers.Add(1)
			go func() {
				defer workers.Done()
				defer conn.Close()
				reader := bufio.NewReader(conn)
				for {
					args, err := readRedisProtocolArray(reader)
					if err != nil {
						return
					}
					response := "+OK\r\n"
					switch strings.ToUpper(args[0]) {
					case "HELLO":
						response = "-ERR unknown command 'HELLO'\r\n"
					case "PING":
						response = "+PONG\r\n"
					case "INCR":
						writes.Add(1)
						// The write took effect, but its response was lost.
						return
					}
					if _, err := io.WriteString(conn, response); err != nil {
						return
					}
				}
			}()
		}
	}()
	t.Cleanup(func() {
		if err := listener.Close(); err != nil {
			t.Error(err)
		}
		<-stopped
		workers.Wait()
	})
	host, rawPort, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(rawPort)
	if err != nil {
		t.Fatal(err)
	}
	client := &RedisClientImpl{}
	if err := client.Connect(connection.ConnectionConfig{Type: "redis", Host: host, Port: port}); err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	_, err = client.ExecuteCommand([]string{"INCR", "test:counter"})
	if !errors.Is(err, io.EOF) || writes.Load() != 1 {
		t.Fatalf("err=%v writes=%d", err, writes.Load())
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	BindMetadataContext(client, ctx)
	defer ClearMetadataContext(client)
	_, err = client.ExecuteCommand([]string{"INCR", "test:counter"})
	if !errors.Is(err, context.Canceled) || writes.Load() != 1 {
		t.Fatalf("cancelled command dispatched: err=%v writes=%d", err, writes.Load())
	}
}
