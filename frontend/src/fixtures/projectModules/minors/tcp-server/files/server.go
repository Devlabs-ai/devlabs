package main

import (
	"context"
	"fmt"
	"net"
	"sync"
)

// Server accepts client connections and serves the line protocol.
type Server struct {
	cfg Config
	log *Logger

	// mu guards ln, conns and closing. Everything else is set once in NewServer.
	mu      sync.Mutex
	ln      net.Listener
	conns   map[*conn]struct{}
	closing bool

	// wg counts in-flight connection handlers so Close can wait for them.
	wg sync.WaitGroup
	// closeOnce keeps Close idempotent: both the signal handler and a caller
	// in a test may reach it.
	closeOnce sync.Once
}

// NewServer builds a server. Nothing is bound until Listen or Run is called.
func NewServer(cfg Config, log *Logger) *Server {
	return &Server{
		cfg:   cfg,
		log:   log,
		conns: make(map[*conn]struct{}),
	}
}

// Listen binds the configured address and makes the socket passive.
//
// Separate from Run so tests can bind port 0, read back the real address, and
// dial it without racing the accept loop.
func (s *Server) Listen() error {
	// ── TODO(1.1) — bind the listening socket ────────────────────────────────
	//
	// What to do:
	//   1. net.Listen("tcp", s.cfg.Addr) to create + bind + listen in one call.
	//   2. On failure, return an error that names the address, e.g.
	//      fmt.Errorf("listen %s: %w", s.cfg.Addr, err).
	//   3. On success, store the listener on s.ln while holding s.mu — Close
	//      runs on a different goroutine and reads the same field.
	//
	// Do not accept anything here. Listen only creates the accept queue; the
	// loop below is what drains it.
	//
	// Done when: TestServerPing gets as far as dialing the server.
	panic("TODO(1.1): bind the listening socket")
}

// Addr reports the bound address, useful when the config asked for port 0.
func (s *Server) Addr() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ln == nil {
		return s.cfg.Addr
	}
	return s.ln.Addr().String()
}

// Run binds, serves until ctx is cancelled, and shuts down cleanly.
func (s *Server) Run(ctx context.Context) error {
	if err := s.Listen(); err != nil {
		return err
	}
	s.log.Infof("listening on %s", s.Addr())

	// Accept() blocks, so cancellation cannot be checked inside the loop. The
	// only way to interrupt it is to close the listener from out here.
	stopped := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			s.log.Infof("signal received, shutting down")
			_ = s.Close()
		case <-stopped:
		}
	}()
	defer close(stopped)

	return s.acceptLoop()
}

// acceptLoop pulls connections off the accept queue until shutdown.
func (s *Server) acceptLoop() error {
	// ── TODO(1.2) — the accept loop ──────────────────────────────────────────
	//
	// Loop forever:
	//   1. nc, err := s.ln.Accept()
	//   2. On error, decide which kind it is:
	//        - if s.isClosing(), this is the expected error from Close() racing
	//          the blocked Accept. Return nil: shutdown is not a failure.
	//        - otherwise return the error and let main exit non-zero.
	//   3. On success, wrap it with newConn(s, nc), register it with s.track,
	//      add 1 to s.wg, and serve it on its own goroutine. Remember to
	//      s.wg.Done() when that goroutine returns.
	//
	// Watch out for:
	//   - Losing the connection on the shutdown path. If s.isClosing() is true
	//     after a successful Accept, close nc instead of serving it.
	//   - Capturing the loop variable. Pass the conn into the goroutine or
	//     shadow it; a stale capture serves the wrong socket.
	//
	// Worth knowing: some Accept errors are temporary (EMFILE — out of file
	// descriptors). A production server logs and backs off instead of dying.
	// Returning the error is fine for this sitting.
	//
	// Done when: TestServerPing and TestServerConcurrentClients pass.
	panic("TODO(1.2): implement the accept loop")
}

// Close stops accepting, drops live connections, and waits for handlers.
func (s *Server) Close() error {
	// ── TODO(1.4) — graceful shutdown ────────────────────────────────────────
	//
	// Run the body inside s.closeOnce.Do so a second call is a no-op.
	//
	//   1. Under s.mu: set s.closing = true, grab s.ln, and copy the set of
	//      live conns into a slice. Do not call into connections while holding
	//      the lock — their close path calls s.untrack, which takes s.mu again.
	//   2. Close the listener. That unblocks the goroutine parked in Accept.
	//   3. Call c.shutdown() on each connection you copied out — not c.close().
	//      shutdown only closes the socket, which is safe from this goroutine;
	//      close touches the connection's buffered writer, which belongs to the
	//      handler goroutine. Closing the socket is what makes that handler's
	//      read return so it can clean up after itself.
	//   4. s.wg.Wait() so every handler has actually returned before Close
	//      does. This is the difference between a graceful shutdown and a
	//      process that exits while a reply is half written. It is also what
	//      makes connCount() reliably zero when Close returns.
	//
	// Return the listener's close error (nil if it was never bound).
	//
	// Done when: TestServerGracefulShutdown passes and "make run" exits
	// promptly on Ctrl-C instead of hanging.
	panic("TODO(1.4): implement graceful shutdown")
}

// isClosing reports whether Close has been entered. The accept loop uses it to
// tell "we asked for this" apart from a genuine listener failure.
func (s *Server) isClosing() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closing
}

func (s *Server) track(c *conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.conns[c] = struct{}{}
}

func (s *Server) untrack(c *conn) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.conns, c)
}

// connCount is used by tests to assert that handlers really did go away.
func (s *Server) connCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.conns)
}

func listenErr(addr string, err error) error {
	return fmt.Errorf("listen %s: %w", addr, err)
}
