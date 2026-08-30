package main

import (
	"bufio"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// These tests talk to the server over a real socket on an ephemeral port —
// no mocks, no injected fakes — so passing them means the network path works.

func startTestServer(t *testing.T, tune func(*Config)) *Server {
	t.Helper()

	cfg := Default()
	cfg.Addr = "127.0.0.1:0"
	cfg.LogLevel = "error"
	if tune != nil {
		tune(&cfg)
	}

	srv := NewServer(cfg, NewLogger(cfg.LogLevel))
	if err := srv.Listen(); err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() { _ = srv.acceptLoop() }()
	t.Cleanup(func() { _ = srv.Close() })

	return srv
}

func dial(t *testing.T, srv *Server) (net.Conn, *bufio.Reader) {
	t.Helper()
	nc, err := net.DialTimeout("tcp", srv.Addr(), 2*time.Second)
	if err != nil {
		t.Fatalf("dial %s: %v", srv.Addr(), err)
	}
	t.Cleanup(func() { _ = nc.Close() })
	_ = nc.SetDeadline(time.Now().Add(3 * time.Second))
	return nc, bufio.NewReader(nc)
}

func roundTrip(t *testing.T, nc net.Conn, r *bufio.Reader, req string) string {
	t.Helper()
	if _, err := nc.Write([]byte(req + "\r\n")); err != nil {
		t.Fatalf("write %q: %v", req, err)
	}
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatalf("read reply to %q: %v", req, err)
	}
	return strings.TrimRight(line, "\r\n")
}

func TestServerPing(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if got := roundTrip(t, nc, r, "PING"); got != "PONG" {
		t.Fatalf("PING = %q, want %q", got, "PONG")
	}
	if got := roundTrip(t, nc, r, "ECHO hello"); got != "hello" {
		t.Fatalf("ECHO = %q, want %q", got, "hello")
	}
	if got := roundTrip(t, nc, r, "NOPE"); !strings.HasPrefix(got, "ERR") {
		t.Fatalf("unknown command = %q, want an ERR reply", got)
	}
}

// Pipelining: two requests in one write must produce two replies in order.
// This is the test that fails when you treat one Read as one request.
func TestServerPipelinedRequests(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if _, err := nc.Write([]byte("PING\r\nECHO two\r\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	for _, want := range []string{"PONG", "two"} {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if got := strings.TrimRight(line, "\r\n"); got != want {
			t.Fatalf("reply = %q, want %q", got, want)
		}
	}
}

// "printf 'PING\r\n' | nc host port" sends everything, then shuts down its
// write side and waits for the reply. The read loop must answer what already
// arrived instead of treating EOF as "stop immediately".
func TestServerHalfClose(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if _, err := nc.Write([]byte("PING\r\nECHO bye\r\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	tcp, ok := nc.(*net.TCPConn)
	if !ok {
		t.Fatal("expected a TCP connection")
	}
	if err := tcp.CloseWrite(); err != nil {
		t.Fatalf("CloseWrite: %v", err)
	}

	for _, want := range []string{"PONG", "bye"} {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read after half-close: %v", err)
		}
		if got := strings.TrimRight(line, "\r\n"); got != want {
			t.Fatalf("reply = %q, want %q", got, want)
		}
	}
}

func TestServerQuit(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if got := roundTrip(t, nc, r, "QUIT"); got != "BYE" {
		t.Fatalf("QUIT = %q, want %q", got, "BYE")
	}
	if _, err := r.ReadString('\n'); err == nil {
		t.Fatal("server kept the connection open after QUIT")
	}
}

func TestServerConcurrentClients(t *testing.T) {
	srv := startTestServer(t, nil)

	const clients = 25
	var wg sync.WaitGroup
	wg.Add(clients)
	for i := 0; i < clients; i++ {
		go func() {
			defer wg.Done()
			nc, err := net.DialTimeout("tcp", srv.Addr(), 2*time.Second)
			if err != nil {
				t.Errorf("dial: %v", err)
				return
			}
			defer func() { _ = nc.Close() }()
			_ = nc.SetDeadline(time.Now().Add(3 * time.Second))

			r := bufio.NewReader(nc)
			if _, err := nc.Write([]byte("PING\r\n")); err != nil {
				t.Errorf("write: %v", err)
				return
			}
			line, err := r.ReadString('\n')
			if err != nil {
				t.Errorf("read: %v", err)
				return
			}
			if got := strings.TrimRight(line, "\r\n"); got != "PONG" {
				t.Errorf("reply = %q, want PONG", got)
			}
		}()
	}
	wg.Wait()
}

func TestServerLineTooLong(t *testing.T) {
	srv := startTestServer(t, func(c *Config) { c.MaxLineBytes = 64 })
	nc, r := dial(t, srv)

	if _, err := nc.Write([]byte(strings.Repeat("x", 4096))); err != nil {
		t.Fatalf("write: %v", err)
	}
	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got := strings.TrimRight(line, "\r\n"); !strings.HasPrefix(got, "ERR") {
		t.Fatalf("reply = %q, want an ERR reply", got)
	}
}

func TestServerIdleTimeout(t *testing.T) {
	srv := startTestServer(t, func(c *Config) { c.IdleTimeout = 150 * time.Millisecond })
	nc, r := dial(t, srv)

	start := time.Now()
	if _, err := r.ReadString('\n'); err == nil {
		t.Fatal("idle connection was not closed")
	}
	if elapsed := time.Since(start); elapsed > 2*time.Second {
		t.Fatalf("idle close took %v, want ~150ms", elapsed)
	}
	_ = nc
}

func TestServerGracefulShutdown(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if got := roundTrip(t, nc, r, "PING"); got != "PONG" {
		t.Fatalf("PING = %q, want PONG", got)
	}

	if err := srv.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}
	if n := srv.connCount(); n != 0 {
		t.Fatalf("%d connections still tracked after Close", n)
	}
	if _, err := r.ReadString('\n'); err == nil {
		t.Fatal("client connection survived shutdown")
	}
	if err := srv.Close(); err != nil {
		t.Fatalf("second Close: %v", err)
	}
}
