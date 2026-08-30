package server

import (
	"bufio"
	"context"
	"net"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/devlabs/cinder/internal/config"
	"github.com/devlabs/cinder/internal/logx"
)

// Module 1's tests are repeated here verbatim, on purpose. Replacing the
// concurrency model must not change one observable behaviour: same replies,
// same pipelining, same shutdown. The loop-specific tests are at the bottom.

func startTestServer(t *testing.T, tune func(*config.Config)) *Server {
	t.Helper()

	cfg := config.Default()
	cfg.Addr = "127.0.0.1:0"
	cfg.LogLevel = "error"
	if tune != nil {
		tune(&cfg)
	}

	srv, err := New(cfg, logx.New(cfg.LogLevel))
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	// Bind before Run so Addr is known and the dial below cannot race.
	if err := srv.Listen(); err != nil {
		t.Fatalf("Listen: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- srv.Run(context.Background()) }()

	t.Cleanup(func() {
		_ = srv.Close()
		select {
		case err := <-done:
			if err != nil {
				t.Errorf("Run: %v", err)
			}
		case <-time.After(3 * time.Second):
			t.Error("Run did not return within 3s of Close")
		}
	})

	return srv
}

func dial(t *testing.T, srv *Server) (net.Conn, *bufio.Reader) {
	t.Helper()
	nc, err := net.DialTimeout("tcp", srv.Addr(), 2*time.Second)
	if err != nil {
		t.Fatalf("dial %s: %v", srv.Addr(), err)
	}
	t.Cleanup(func() { _ = nc.Close() })
	_ = nc.SetDeadline(time.Now().Add(5 * time.Second))
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

	if got := roundTrip(t, nc, r, "PING"); got != "+PONG" {
		t.Fatalf("PING = %q, want +PONG", got)
	}
	if got := roundTrip(t, nc, r, "ECHO hello"); got != "$hello" {
		t.Fatalf("ECHO = %q, want $hello", got)
	}
	if got := roundTrip(t, nc, r, "NOPE"); !strings.HasPrefix(got, "-ERR") {
		t.Fatalf("unknown command = %q, want an -ERR reply", got)
	}
}

func TestServerPipelinedRequests(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if _, err := nc.Write([]byte("PING\r\nECHO two\r\nPING\r\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	for _, want := range []string{"+PONG", "$two", "+PONG"} {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("read: %v", err)
		}
		if got := strings.TrimRight(line, "\r\n"); got != want {
			t.Fatalf("reply = %q, want %q", got, want)
		}
	}
}

// A request split across two packets must not be executed until it is whole,
// and must not be lost. This is the test that fails when framing is done per
// read instead of over the accumulated buffer.
func TestServerPartialFrame(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if _, err := nc.Write([]byte("PI")); err != nil {
		t.Fatalf("write: %v", err)
	}
	time.Sleep(100 * time.Millisecond)
	if _, err := nc.Write([]byte("NG\r\n")); err != nil {
		t.Fatalf("write: %v", err)
	}

	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got := strings.TrimRight(line, "\r\n"); got != "+PONG" {
		t.Fatalf("reply = %q, want +PONG", got)
	}
}

// "printf 'PING\r\n' | nc host port" sends everything, then shuts down its
// write side and waits for the reply. A server that treats EOF as "close now"
// answers nothing at all — and the unit tests above would never notice, because
// they keep the connection open.
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

	for _, want := range []string{"+PONG", "$bye"} {
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

	if got := roundTrip(t, nc, r, "QUIT"); got != "+OK" {
		t.Fatalf("QUIT = %q, want +OK", got)
	}
	if _, err := r.ReadString('\n'); err == nil {
		t.Fatal("server kept the connection open after QUIT")
	}
}

func TestServerLineTooLong(t *testing.T) {
	srv := startTestServer(t, func(c *config.Config) { c.MaxLineBytes = 4096 })
	nc, r := dial(t, srv)

	go func() {
		// No newline, ever. The server must refuse instead of buffering.
		_, _ = nc.Write([]byte(strings.Repeat("x", 64*1024)))
	}()

	line, err := r.ReadString('\n')
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if got := strings.TrimRight(line, "\r\n"); !strings.HasPrefix(got, "-ERR") {
		t.Fatalf("reply = %q, want an -ERR reply", got)
	}
}

func TestServerConcurrentClients(t *testing.T) {
	srv := startTestServer(t, nil)

	const clients = 50
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
			_ = nc.SetDeadline(time.Now().Add(5 * time.Second))

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
			if got := strings.TrimRight(line, "\r\n"); got != "+PONG" {
				t.Errorf("reply = %q, want +PONG", got)
			}
		}()
	}
	wg.Wait()
}

// Fifty clients, one command each, counted with a non-atomic int on the server.
// If any command ran off the loop goroutine, "go test -race" reports a data
// race and this becomes the most useful failure in the suite.
func TestCommandsRunOnOneThread(t *testing.T) {
	srv := startTestServer(t, nil)

	const clients = 50
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
			_ = nc.SetDeadline(time.Now().Add(5 * time.Second))

			r := bufio.NewReader(nc)
			_, _ = nc.Write([]byte("PING\r\n"))
			_, _ = r.ReadString('\n')
		}()
	}
	wg.Wait()

	_ = srv.Close() // the loop has stopped, so reading server state is safe now
	if srv.commandsRun != clients {
		t.Fatalf("commandsRun = %d, want %d", srv.commandsRun, clients)
	}
}

// A client that never reads makes the server's send buffer back up. The server
// must keep serving: no blocking write, no busy spin, no dropped bytes.
func TestBackpressureArmsWriteInterest(t *testing.T) {
	srv := startTestServer(t, func(c *config.Config) { c.MaxLineBytes = 128 * 1024 })
	nc, r := dial(t, srv)
	_ = nc.SetDeadline(time.Now().Add(20 * time.Second))

	const requests = 64
	payload := strings.Repeat("y", 32*1024)
	req := "ECHO " + payload + "\r\n"

	// Write ~2 MB of requests without reading a single reply.
	go func() {
		for i := 0; i < requests; i++ {
			if _, err := nc.Write([]byte(req)); err != nil {
				return
			}
		}
	}()

	// Now drain. Every reply must arrive intact and in order.
	for i := 0; i < requests; i++ {
		line, err := r.ReadString('\n')
		if err != nil {
			t.Fatalf("reply %d: %v", i, err)
		}
		got := strings.TrimRight(line, "\r\n")
		if len(got) != len(payload)+1 || got[0] != '$' {
			t.Fatalf("reply %d: length %d, want %d", i, len(got), len(payload)+1)
		}
	}
}

func TestServerGracefulShutdown(t *testing.T) {
	srv := startTestServer(t, nil)
	nc, r := dial(t, srv)

	if got := roundTrip(t, nc, r, "PING"); got != "+PONG" {
		t.Fatalf("PING = %q, want +PONG", got)
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
