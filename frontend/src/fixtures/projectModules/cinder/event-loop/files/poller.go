// Package evloop is Cinder's single-threaded readiness loop.
//
// The split is deliberate: this file defines a portable vocabulary, the
// per-platform files wrap epoll and kqueue behind it, and loop.go drives the
// whole thing. You implement the driving, not the syscall plumbing.
package evloop

import "errors"

// Kind is a bitmask of readiness interests.
type Kind uint8

const (
	// Readable means "a read would not block" — data arrived, the peer closed,
	// or (on a listener) a connection is waiting to be accepted.
	Readable Kind = 1 << iota
	// Writable means "a write would not block" — there is room in the socket
	// send buffer. Only arm this while you actually have bytes to flush.
	Writable
)

// Has reports whether k contains every bit in other.
func (k Kind) Has(other Kind) bool { return k&other == other }

// Event is one readiness notification for one descriptor.
type Event struct {
	FD   int
	Kind Kind
}

// Poller is the platform readiness API. epoll on Linux, kqueue on macOS/BSD.
//
// Wait fills the caller's slice instead of allocating, because it runs on the
// hot path a few thousand times a second and every allocation there is garbage
// the loop has to collect later.
type Poller interface {
	Add(fd int, interest Kind) error
	Modify(fd int, interest Kind) error
	Remove(fd int) error
	Wait(events []Event, timeoutMs int) (int, error)
	Close() error
}

// ErrClosed is returned by a Poller whose Close already ran.
var ErrClosed = errors.New("evloop: poller closed")

// NewPoller builds the best poller for this platform, sized for at most
// maxEvents notifications per Wait.
func NewPoller(maxEvents int) (Poller, error) {
	if maxEvents <= 0 {
		maxEvents = 128
	}
	return newPoller(maxEvents)
}
