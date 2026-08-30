// Package server is Cinder's network layer, now driven by a single event loop.
//
// Module 1 called net.Listen and let the standard library hide the socket.
// Here the loop needs the raw descriptor, so the listener is opened by hand —
// the same socket/bind/listen/accept sequence, one layer down.
//
// The exported surface is identical to module 1 on purpose: New, Listen, Addr,
// Run, Close. main.go cannot tell which concurrency model it is running.
package server

import (
	"context"
	"fmt"
	"net"
	"strconv"
	"sync"
	"sync/atomic"
	"syscall"

	"github.com/devlabs/cinder/internal/config"
	"github.com/devlabs/cinder/internal/evloop"
	"github.com/devlabs/cinder/internal/logx"
	"github.com/devlabs/cinder/internal/proto"
)

// Server implements evloop.Handler: the loop hands it readiness, it hands back
// socket work.
type Server struct {
	cfg  config.Config
	log  *logx.Logger
	loop *evloop.Loop

	lnFD  int
	conns map[int]*conn

	// readBuf is a single scratch buffer shared by every connection. One
	// buffer is safe precisely because reads happen one at a time on the loop
	// goroutine — with goroutine-per-connection this would need to be per-conn.
	readBuf []byte

	// commandsRun is a plain int, not an atomic, on purpose: if command
	// execution ever escapes the loop goroutine, "go test -race" will say so.
	commandsRun int

	started     atomic.Bool
	stopped     chan struct{}
	closeOnce   sync.Once
	cleanupOnce sync.Once
}

// New builds the server and its loop. Nothing is bound yet.
func New(cfg config.Config, log *logx.Logger) (*Server, error) {
	s := &Server{
		cfg:     cfg,
		log:     log,
		lnFD:    -1,
		conns:   make(map[int]*conn),
		readBuf: make([]byte, cfg.ReadBufBytes),
		stopped: make(chan struct{}),
	}
	loop, err := evloop.New(s, cfg.MaxEvents, cfg.PollTimeoutMs)
	if err != nil {
		return nil, err
	}
	s.loop = loop
	return s, nil
}

// Listen opens the listening socket by hand and registers it with the loop.
//
// Given to you — it is the theory's four syscalls, in order. Note that the
// listener goes through Loop.Register like any other descriptor, so it becomes
// non-blocking too: accept must never park the loop.
func (s *Server) Listen() error {
	sa, err := resolveTCP4(s.cfg.Addr)
	if err != nil {
		return err
	}

	fd, err := syscall.Socket(syscall.AF_INET, syscall.SOCK_STREAM, syscall.IPPROTO_TCP)
	if err != nil {
		return fmt.Errorf("socket: %w", err)
	}

	// Without SO_REUSEADDR a restart fails with EADDRINUSE while the previous
	// socket sits in TIME_WAIT — up to two minutes of failed deploys.
	if err := syscall.SetsockoptInt(fd, syscall.SOL_SOCKET, syscall.SO_REUSEADDR, 1); err != nil {
		_ = syscall.Close(fd)
		return fmt.Errorf("setsockopt(SO_REUSEADDR): %w", err)
	}
	if err := syscall.Bind(fd, sa); err != nil {
		_ = syscall.Close(fd)
		return fmt.Errorf("bind %s: %w", s.cfg.Addr, err)
	}
	if err := syscall.Listen(fd, s.cfg.Backlog); err != nil {
		_ = syscall.Close(fd)
		return fmt.Errorf("listen %s: %w", s.cfg.Addr, err)
	}

	s.lnFD = fd
	if err := s.loop.Register(fd, evloop.Readable); err != nil {
		_ = syscall.Close(fd)
		s.lnFD = -1
		return err
	}
	return nil
}

// Addr reports the bound address, resolved from the socket so that port 0
// (used by tests) reports the port the kernel actually picked.
func (s *Server) Addr() string {
	if s.lnFD < 0 {
		return s.cfg.Addr
	}
	sa, err := syscall.Getsockname(s.lnFD)
	if err != nil {
		return s.cfg.Addr
	}
	in4, ok := sa.(*syscall.SockaddrInet4)
	if !ok {
		return s.cfg.Addr
	}
	ip := net.IPv4(in4.Addr[0], in4.Addr[1], in4.Addr[2], in4.Addr[3])
	return net.JoinHostPort(ip.String(), strconv.Itoa(in4.Port))
}

// Run binds if needed and drives the loop until ctx is cancelled.
func (s *Server) Run(ctx context.Context) error {
	if s.lnFD < 0 {
		if err := s.Listen(); err != nil {
			return err
		}
	}
	s.log.Infof("cinder listening on %s (event loop)", s.Addr())
	s.started.Store(true)

	go func() {
		select {
		case <-ctx.Done():
			s.log.Infof("signal received, shutting down")
			_ = s.Close()
		case <-s.stopped:
		}
	}()

	err := s.loop.Run()
	// Run has returned, so the loop goroutine is gone and this is now the only
	// thread touching connection state.
	s.cleanup()
	close(s.stopped)
	return err
}

// Close asks the loop to stop and waits for it to finish.
//
// Safe to call twice, and safe to call before Run.
func (s *Server) Close() error {
	s.closeOnce.Do(func() { s.loop.Stop() })
	if s.started.Load() {
		<-s.stopped
		return nil
	}
	s.cleanup()
	return nil
}

func (s *Server) cleanup() {
	s.cleanupOnce.Do(func() {
		for _, c := range s.conns {
			s.closeConn(c)
		}
		if s.lnFD >= 0 {
			_ = s.loop.Deregister(s.lnFD)
			_ = syscall.Close(s.lnFD)
			s.lnFD = -1
		}
		_ = s.loop.Close()
	})
}

// OnReadable is called by the loop. The listener and a client take different
// paths, which is the only branch in the dispatch.
func (s *Server) OnReadable(fd int) error {
	if fd == s.lnFD {
		return s.onAccept()
	}
	c, ok := s.conns[fd]
	if !ok {
		// A descriptor we already closed. Drop the registration and move on.
		_ = s.loop.Deregister(fd)
		return nil
	}
	return s.onReadable(c)
}

// OnWritable is called when a backed-up socket has room again.
func (s *Server) OnWritable(fd int) error {
	c, ok := s.conns[fd]
	if !ok {
		_ = s.loop.Deregister(fd)
		return nil
	}
	return s.flush(c)
}

// onAccept drains the accept queue.
func (s *Server) onAccept() error {
	// ── TODO(2.3) — accept every queued connection ───────────────────────────
	//
	// Loop:
	//   1. nfd, sa, err := syscall.Accept(s.lnFD)
	//   2. Error handling, in this order:
	//        - syscall.EINTR: retry, continue.
	//        - syscall.EAGAIN: the queue is empty. This is the normal exit —
	//          return nil. (EWOULDBLOCK is the same value on Linux and macOS,
	//          so listing both in one switch is a duplicate-case compile
	//          error. Check one, or use an if.)
	//        - syscall.ECONNABORTED: the peer gave up between the handshake
	//          and our accept. Skip it, continue.
	//        - syscall.EMFILE / syscall.ENFILE: out of descriptors. Log at
	//          error and return nil. Do not kill the server because it is
	//          popular — but do not spin either.
	//        - anything else: return the error.
	//   3. On success:
	//        - tuneClientSocket(nfd) (given below)
	//        - c := newConn(nfd, sa); s.conns[nfd] = c
	//        - s.loop.Register(nfd, evloop.Readable). If that fails, close nfd
	//          and delete it from the map — a half-registered connection is a
	//          descriptor leak.
	//        - log at debug: accepted c.remote
	//
	// Why loop instead of accepting once: level-triggered readiness fires once
	// for the queue, not once per connection. Accept a single client per event
	// and the rest wait for the next unrelated wakeup.
	//
	// Done when: TestServerPing and TestServerConcurrentClients pass.
	panic("TODO(2.3): drain the accept queue")
}

// onReadable reads and executes everything this client has sent.
func (s *Server) onReadable(c *conn) error {
	// ── TODO(2.4) — read, frame, execute ─────────────────────────────────────
	//
	// Phase 1 — drain the socket into c.in:
	//
	//   for {
	//       n, err := syscall.Read(c.fd, s.readBuf)
	//       - err == syscall.EINTR: continue
	//       - err == syscall.EAGAIN (same value as EWOULDBLOCK): the socket is
	//         drained. break.
	//       - err != nil: s.closeConn(c); return nil
	//       - n == 0: the peer shut down its write side. Set c.peerClosed and
	//         break — do NOT close here, and do not set closeAfterFlush yet.
	//         The client may have sent requests it is still waiting to hear
	//         back about; "printf ... | nc" does exactly this, sending
	//         everything and then half-closing, often fast enough that the
	//         data and the FIN land in the same readiness event. Closing on
	//         EOF before phase 2 throws those replies away.
	//       - otherwise append s.readBuf[:n] to c.in
	//   }
	//
	//   Guard the buffer: if len(c.in) > s.cfg.MaxLineBytes and there is still
	//   no newline in it, the client is streaming an unterminated line at you.
	//   Reply proto.Error("request line too long"), set c.closeAfterFlush,
	//   flush, and return. Delimiter framing without this cap is a memory
	//   exhaustion bug, not a style issue.
	//
	// Phase 2 — execute every complete frame:
	//
	//   for {
	//       line, rest, ok := proto.NextFrame(c.in)
	//       if !ok { break }
	//       c.in = rest
	//       s.execute(c, line)
	//       if c.closeAfterFlush { break }   // QUIT: stop, do not run the rest
	//   }
	//
	//   Then, if c.peerClosed, set c.closeAfterFlush — there is nothing more
	//   coming, so the connection goes away once the replies are out.
	//
	// Phase 3 — return s.flush(c) to push the replies out.
	//
	// Note what phase 2 gives you for free: pipelining. Ten requests that
	// arrived in one packet run as ten frames and produce one flush, which is
	// one write syscall instead of ten.
	//
	// Done when: TestServerPipelinedRequests, TestServerPartialFrame and
	// TestServerLineTooLong pass.
	panic("TODO(2.4): read, frame, and execute")
}

// execute runs one framed request and queues its reply.
//
// Given: module 4 replaces this switch with a dispatch table over the keyspace.
// Notice there is no locking, and no atomics — this runs on the loop thread,
// one command at a time, start to finish. That is what makes commands atomic.
func (s *Server) execute(c *conn, line []byte) {
	req, err := proto.ParseLine(string(line))
	if err != nil {
		return // blank line: not a request, not an error
	}
	s.commandsRun++

	switch req.Name {
	case "PING":
		if len(req.Args) > 0 {
			c.appendOut(proto.Payload(req.Args[0]))
			return
		}
		c.appendOut(proto.Simple("PONG"))
	case "ECHO":
		if len(req.Args) != 1 {
			c.appendOut(proto.Error("wrong number of arguments for ECHO"))
			return
		}
		c.appendOut(proto.Payload(req.Args[0]))
	case "QUIT":
		c.appendOut(proto.Simple("OK"))
		c.closeAfterFlush = true
	default:
		c.appendOut(proto.Errorf("unknown command %q", req.Name))
	}
}

// flush writes what it can and arms or disarms write interest accordingly.
//
// Given, because the arming rule is easy to state and easy to get wrong:
// interest ON while bytes remain, OFF the moment they are gone. An idle socket
// is almost always writable, so leaving it armed means Wait returns instantly
// forever — 100% CPU with zero clients.
func (s *Server) flush(c *conn) error {
	written := 0
	for written < len(c.out) {
		n, err := syscall.Write(c.fd, c.out[written:])
		if err == syscall.EINTR {
			continue
		}
		if err == syscall.EAGAIN || err == syscall.EWOULDBLOCK {
			break // send buffer is full; the rest waits for writability
		}
		if err != nil {
			s.log.Debugf("write %s: %v", c.remote, err)
			s.closeConn(c)
			return nil
		}
		if n <= 0 {
			break
		}
		written += n
	}

	if written == len(c.out) {
		c.out = c.out[:0]
	} else {
		// Keep the tail, reusing the same backing array.
		c.out = append(c.out[:0], c.out[written:]...)
	}

	if len(c.out) == 0 {
		if c.closeAfterFlush {
			s.closeConn(c)
			return nil
		}
		if c.writeArmed {
			c.writeArmed = false
			return s.loop.Modify(c.fd, evloop.Readable)
		}
		return nil
	}

	if !c.writeArmed {
		c.writeArmed = true
		return s.loop.Modify(c.fd, evloop.Readable|evloop.Writable)
	}
	return nil
}

// closeConn deregisters, closes, and forgets a connection. Idempotent.
func (s *Server) closeConn(c *conn) {
	if _, ok := s.conns[c.fd]; !ok {
		return
	}
	delete(s.conns, c.fd)
	_ = s.loop.Deregister(c.fd)
	_ = syscall.Close(c.fd)
	s.log.Debugf("closed %s", c.remote)
}

// connCount is for tests. Only meaningful from the loop goroutine, or after
// Close has returned and the loop is gone.
func (s *Server) connCount() int { return len(s.conns) }

// tuneClientSocket applies the per-connection socket options.
func tuneClientSocket(fd int) {
	// TCP_NODELAY disables Nagle's algorithm. Nagle holds a small write back
	// waiting for more data to coalesce, which for a request/response protocol
	// means up to 40ms of pure latency added to a reply that was ready.
	_ = syscall.SetsockoptInt(fd, syscall.IPPROTO_TCP, syscall.TCP_NODELAY, 1)
}

func resolveTCP4(addr string) (syscall.Sockaddr, error) {
	tcpAddr, err := net.ResolveTCPAddr("tcp4", addr)
	if err != nil {
		return nil, fmt.Errorf("resolve %s: %w", addr, err)
	}
	sa := &syscall.SockaddrInet4{Port: tcpAddr.Port}
	if ip4 := tcpAddr.IP.To4(); ip4 != nil {
		copy(sa.Addr[:], ip4)
	}
	return sa, nil
}
