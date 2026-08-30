package main

import (
	"bufio"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

// ErrLineTooLong is returned when a client sends more than MaxLineBytes without
// a newline. Delimiter framing without this check is a memory exhaustion bug.
var ErrLineTooLong = errors.New("request line exceeds limit")

// conn is one accepted client. Exactly one goroutine touches a conn at a time,
// so no field here needs synchronising — closeOnce only exists because Close
// (from the server) and serve (from the handler goroutine) can both reach the
// teardown path.
type conn struct {
	srv *Server
	nc  net.Conn
	r   *bufio.Reader
	w   *bufio.Writer

	closeOnce sync.Once
}

func newConn(srv *Server, nc net.Conn) *conn {
	return &conn{
		srv: srv,
		nc:  nc,
		// The reader's buffer size *is* the framing cap: ReadSlice reports
		// ErrBufferFull rather than growing when a line does not fit.
		r: bufio.NewReaderSize(nc, srv.cfg.MaxLineBytes),
		// Buffering writes means one syscall per batch of replies instead of
		// one per reply. Nothing reaches the socket until Flush.
		w: bufio.NewWriter(nc),
	}
}

// serve is the per-connection read loop. It runs on its own goroutine and owns
// the connection until it returns.
func (c *conn) serve() {
	defer c.close()

	// ── TODO(1.3) — the connection read loop ─────────────────────────────────
	//
	// Loop until the peer goes away:
	//
	//   1. Deadline. If c.srv.cfg.IdleTimeout > 0, call
	//      c.nc.SetReadDeadline(time.Now().Add(...)) before every read. The
	//      deadline is absolute, so it has to be refreshed each iteration.
	//
	//   2. Read one frame with c.readLine(). Handle three error cases:
	//        - io.EOF: the client hung up cleanly. Return, no log, no reply.
	//        - ErrLineTooLong: reply ErrorReply("request line too long"),
	//          flush, and return. The stream is unframed now — you cannot know
	//          where the next request starts, so the connection is finished.
	//        - a net.Error with Timeout() true: the idle timeout fired. Log at
	//          debug and return.
	//        - anything else: log at debug and return.
	//
	//   3. Parse with ParseLine. ErrEmpty (a blank line) is not a protocol
	//      violation — skip it and continue.
	//
	//   4. Hand the request to c.handle, write the reply into c.w, and Flush.
	//      A write error means the peer is gone: return.
	//
	//   5. If handle reported closeAfter (QUIT), flush and return.
	//
	// Why flush every iteration: this is a request/response protocol, so a
	// reply sitting in the buffer is a client blocked forever.
	//
	// Done when: TestServerPing, TestServerQuit and TestServerIdleTimeout pass.
	panic("TODO(1.3): implement the connection read loop")
}

// readLine returns one CRLF- or LF-terminated request, without the terminator.
//
// ReadSlice returns a view into the reader's own buffer, which the next read
// will overwrite, so the result is copied into a string before returning.
func (c *conn) readLine() (string, error) {
	raw, err := c.r.ReadSlice('\n')
	if errors.Is(err, bufio.ErrBufferFull) {
		return "", ErrLineTooLong
	}
	if err != nil {
		// A final line without a trailing newline still counts as a request.
		if errors.Is(err, io.EOF) && len(raw) > 0 {
			return trimEOL(string(raw)), nil
		}
		return "", err
	}
	return trimEOL(string(raw)), nil
}

func trimEOL(s string) string {
	if n := len(s); n > 0 && s[n-1] == '\n' {
		s = s[:n-1]
	}
	if n := len(s); n > 0 && s[n-1] == '\r' {
		s = s[:n-1]
	}
	return s
}

// handle turns one request into one reply.
func (c *conn) handle(req Request) (reply string, closeAfter bool) {
	switch req.Name {
	case "PING":
		if len(req.Args) > 0 {
			return Reply(req.Args[0]), false
		}
		return Reply("PONG"), false

	case "ECHO":
		if len(req.Args) != 1 {
			return ErrorReply("wrong number of arguments for ECHO"), false
		}
		return Reply(req.Args[0]), false

	case "QUIT":
		return Reply("BYE"), true

	default:
		return ErrorReplyf("unknown command %q", req.Name), false
	}
}

// close tears the connection down exactly once.
//
// Only the goroutine running serve may call this, because it touches c.w. A
// bufio.Writer has exactly one owner and no internal locking.
func (c *conn) close() {
	c.closeOnce.Do(func() {
		_ = c.w.Flush()
		_ = c.nc.Close()
		c.srv.untrack(c)
	})
}

// shutdown is the version other goroutines are allowed to call — Server.Close
// during shutdown, for instance.
//
// It closes the socket and nothing else. net.Conn.Close is safe to call
// concurrently; c.w is not. Closing the socket unblocks the read in serve,
// which returns and runs close() on its own goroutine, where flushing is safe.
func (c *conn) shutdown() {
	_ = c.nc.Close()
}

func (c *conn) touchDeadline() {
	if c.srv.cfg.IdleTimeout <= 0 {
		return
	}
	_ = c.nc.SetReadDeadline(time.Now().Add(c.srv.cfg.IdleTimeout))
}
