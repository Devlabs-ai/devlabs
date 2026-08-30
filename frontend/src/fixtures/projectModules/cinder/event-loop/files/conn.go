package server

import (
	"net"
	"strconv"
	"syscall"
)

// conn is one client, as seen by the event loop.
//
// There are no mutexes here and there will never be any. Every field is touched
// only from the loop goroutine, which is the payoff for giving up
// goroutine-per-connection in this module.
type conn struct {
	fd     int
	remote string

	// in holds bytes read from the socket that do not yet form a complete
	// request. TCP is a stream, so a request can arrive in pieces and two
	// requests can arrive in one read.
	in []byte

	// out holds bytes the kernel has not accepted yet. Non-empty means the
	// socket send buffer filled up and we are waiting for writability.
	out []byte

	// writeArmed tracks whether the loop is currently watching this fd for
	// writability. Leaving it armed with an empty out buffer is the classic
	// event-loop busy spin: an idle socket is always writable.
	writeArmed bool

	// closeAfterFlush marks a connection that should go away once its pending
	// bytes are on the wire — QUIT, or a protocol error we already replied to.
	closeAfterFlush bool

	// peerClosed means the client shut down its write side. It is deliberately
	// separate from closeAfterFlush: a half-closed peer is still owed replies
	// for everything it sent before the FIN, so the read side being finished
	// must not stop the execute loop.
	peerClosed bool
}

func newConn(fd int, sa syscall.Sockaddr) *conn {
	return &conn{
		fd:     fd,
		remote: sockaddrString(sa),
		in:     make([]byte, 0, 1024),
		out:    make([]byte, 0, 1024),
	}
}

// appendOut queues a reply. Nothing reaches the socket until flush runs.
func (c *conn) appendOut(s string) {
	c.out = append(c.out, s...)
}

func sockaddrString(sa syscall.Sockaddr) string {
	switch a := sa.(type) {
	case *syscall.SockaddrInet4:
		ip := net.IPv4(a.Addr[0], a.Addr[1], a.Addr[2], a.Addr[3])
		return net.JoinHostPort(ip.String(), strconv.Itoa(a.Port))
	case *syscall.SockaddrInet6:
		ip := net.IP(a.Addr[:])
		return net.JoinHostPort(ip.String(), strconv.Itoa(a.Port))
	default:
		return "unknown"
	}
}
