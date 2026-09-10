// Package server is a minimal TCP front-end for the chapter-1 event loop.
//
// It accepts connections, reads CRLF lines, and replies. No CSP, no keyspace —
// those come later. All I/O is driven by eventloop.Handler callbacks.
package server

import (
	"bytes"
	"fmt"
	"net"
	"strings"
	"sync"

	"github.com/devlabs/cinder/internal/eventloop"

	"golang.org/x/sys/unix"
)

// Server listens on TCP and serves a toy line protocol on the event loop.
//
// Client fds are registered Readable-only. Replies are written inside
// OnReadable (write-interest arming is deferred).
type Server struct {
	addr     string
	lnFD     int
	listener net.Listener
	pending  map[int][]byte

	mu   sync.Mutex
	loop *eventloop.Loop
}

// New prepares a server that will bind addr on Start.
func New(addr string) (*Server, error) {
	if addr == "" {
		addr = "127.0.0.1:7379"
	}
	return &Server{
		addr:    addr,
		lnFD:    -1,
		pending: make(map[int][]byte),
	}, nil
}

// Start binds, registers the listen fd, and blocks in the event loop.
func (s *Server) Start() error {
	ln, err := net.Listen("tcp", s.addr)
	if err != nil {
		return fmt.Errorf("listen: %w", err)
	}
	s.listener = ln

	fd, err := listenerFD(ln)
	if err != nil {
		_ = ln.Close()
		return err
	}
	s.lnFD = fd

	loop, err := eventloop.New(s, 128, 100)
	if err != nil {
		s.closeListener()
		return err
	}
	s.mu.Lock()
	s.loop = loop
	s.mu.Unlock()
	defer func() {
		s.mu.Lock()
		s.loop = nil
		s.mu.Unlock()
		_ = loop.Close()
	}()
	defer s.closeListener()

	if err := loop.Register(s.lnFD, eventloop.Readable); err != nil {
		return fmt.Errorf("register listener: %w", err)
	}

	fmt.Printf("cinder listening on %s (event loop)\n", s.addr)
	return loop.Run()
}

// Shutdown asks the loop to stop. Safe from another goroutine.
func (s *Server) Shutdown() {
	s.mu.Lock()
	loop := s.loop
	s.mu.Unlock()
	if loop != nil {
		loop.Stop()
	}
}

// Close releases resources after Start has returned.
func (s *Server) Close() error {
	s.Shutdown()
	s.closeListener()
	return nil
}

func (s *Server) closeListener() {
	s.mu.Lock()
	loop := s.loop
	s.mu.Unlock()
	if s.lnFD >= 0 {
		if loop != nil {
			_ = loop.Deregister(s.lnFD)
		}
		_ = unix.Close(s.lnFD)
		s.lnFD = -1
	}
	if s.listener != nil {
		_ = s.listener.Close()
		s.listener = nil
	}
}

// OnReadable handles the listen socket (accept) or a client (read + reply).
func (s *Server) OnReadable(fd int) error {
	if fd == s.lnFD {
		return s.accept()
	}
	s.readClient(fd)
	return nil
}

// OnWritable is unused while interest is Readable-only.
func (s *Server) OnWritable(fd int) error { return nil }

func (s *Server) accept() error {
	for {
		nfd, _, err := unix.Accept(s.lnFD)
		if err != nil {
			if err == unix.EINTR {
				continue
			}
			if err == unix.EAGAIN || err == unix.EWOULDBLOCK {
				return nil
			}
			return fmt.Errorf("accept: %w", err)
		}

		s.mu.Lock()
		loop := s.loop
		s.mu.Unlock()
		if loop == nil {
			_ = unix.Close(nfd)
			return nil
		}
		if err := loop.Register(nfd, eventloop.Readable); err != nil {
			_ = unix.Close(nfd)
			continue
		}
		s.pending[nfd] = nil
	}
}

func (s *Server) readClient(fd int) {
	buf := make([]byte, 4096)
	n, err := unix.Read(fd, buf)
	if n > 0 {
		s.pending[fd] = append(s.pending[fd], buf[:n]...)
		s.drainLines(fd)
	}
	if err != nil || n == 0 {
		s.closeConn(fd)
	}
}

func (s *Server) drainLines(fd int) {
	for {
		cur := s.pending[fd]
		i := bytes.IndexByte(cur, '\n')
		if i < 0 {
			return
		}
		line := string(bytes.TrimSpace(cur[:i]))
		s.pending[fd] = cur[i+1:]

		reply, quit := handleLine(line)
		_, _ = unix.Write(fd, []byte(reply+"\n"))
		if quit {
			s.closeConn(fd)
			return
		}
	}
}

func handleLine(line string) (reply string, quit bool) {
	if line == "" {
		return "", false
	}
	parts := strings.Fields(line)
	switch strings.ToUpper(parts[0]) {
	case "PING":
		return "PONG", false
	case "ECHO":
		if len(parts) == 1 {
			return "ERR usage: ECHO <text>", false
		}
		return strings.Join(parts[1:], " "), false
	case "QUIT":
		return "BYE", true
	default:
		return fmt.Sprintf("ERR unknown command %q", parts[0]), false
	}
}

func (s *Server) closeConn(fd int) {
	if _, ok := s.pending[fd]; !ok {
		return
	}
	delete(s.pending, fd)
	s.mu.Lock()
	loop := s.loop
	s.mu.Unlock()
	if loop != nil {
		_ = loop.Deregister(fd)
	}
	_ = unix.Close(fd)
}

func listenerFD(l net.Listener) (int, error) {
	tcp, ok := l.(*net.TCPListener)
	if !ok {
		return -1, fmt.Errorf("listener is not TCP")
	}
	f, err := tcp.File()
	if err != nil {
		return -1, fmt.Errorf("listener file: %w", err)
	}
	defer f.Close()

	fd, err := unix.Dup(int(f.Fd()))
	if err != nil {
		return -1, fmt.Errorf("dup listener fd: %w", err)
	}
	return fd, nil
}
