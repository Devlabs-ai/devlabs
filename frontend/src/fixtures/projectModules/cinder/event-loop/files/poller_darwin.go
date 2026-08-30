//go:build darwin || freebsd || netbsd || openbsd

package evloop

import (
	"fmt"
	"syscall"
)

// kqueuePoller is the BSD/macOS half. Same model as epoll — register interest,
// block until something is ready — with one structural difference: read and
// write interest are two separate registrations (filters) rather than two bits
// in one mask. Modify therefore adds one filter and deletes the other.
type kqueuePoller struct {
	fd      int
	raw     []syscall.Kevent_t
	changes []syscall.Kevent_t
}

func newPoller(maxEvents int) (Poller, error) {
	// POSIX says a kqueue descriptor is not inherited across exec, so unlike
	// epoll there is no CLOEXEC flag to set here.
	fd, err := syscall.Kqueue()
	if err != nil {
		return nil, fmt.Errorf("kqueue: %w", err)
	}
	return &kqueuePoller{
		fd:      fd,
		raw:     make([]syscall.Kevent_t, maxEvents),
		changes: make([]syscall.Kevent_t, 0, 4),
	}, nil
}

func (p *kqueuePoller) apply(fd int, interest Kind, adding bool) error {
	p.changes = p.changes[:0]

	readFlags := uint16(syscall.EV_DELETE)
	if interest.Has(Readable) {
		readFlags = syscall.EV_ADD | syscall.EV_ENABLE
	}
	writeFlags := uint16(syscall.EV_DELETE)
	if interest.Has(Writable) {
		writeFlags = syscall.EV_ADD | syscall.EV_ENABLE
	}
	if adding && !interest.Has(Writable) {
		// Nothing to delete on a fresh registration.
		writeFlags = 0
	}
	if adding && !interest.Has(Readable) {
		readFlags = 0
	}

	if readFlags != 0 {
		var ev syscall.Kevent_t
		syscall.SetKevent(&ev, fd, syscall.EVFILT_READ, int(readFlags))
		p.changes = append(p.changes, ev)
	}
	if writeFlags != 0 {
		var ev syscall.Kevent_t
		syscall.SetKevent(&ev, fd, syscall.EVFILT_WRITE, int(writeFlags))
		p.changes = append(p.changes, ev)
	}
	if len(p.changes) == 0 {
		return nil
	}

	// Deleting a filter that was never registered returns ENOENT. That happens
	// every time we drop write interest that was already dropped, so it is not
	// an error worth surfacing.
	if _, err := syscall.Kevent(p.fd, p.changes, nil, nil); err != nil &&
		err != syscall.ENOENT && err != syscall.EBADF {
		return fmt.Errorf("kevent(fd=%d): %w", fd, err)
	}
	return nil
}

func (p *kqueuePoller) Add(fd int, interest Kind) error    { return p.apply(fd, interest, true) }
func (p *kqueuePoller) Modify(fd int, interest Kind) error { return p.apply(fd, interest, false) }

func (p *kqueuePoller) Remove(fd int) error {
	return p.apply(fd, 0, false)
}

func (p *kqueuePoller) Wait(events []Event, timeoutMs int) (int, error) {
	max := len(events)
	if max > len(p.raw) {
		max = len(p.raw)
	}

	var ts *syscall.Timespec
	if timeoutMs >= 0 {
		spec := syscall.NsecToTimespec(int64(timeoutMs) * 1e6)
		ts = &spec
	}

	n, err := syscall.Kevent(p.fd, nil, p.raw[:max], ts)
	if err != nil {
		return 0, err // EINTR is the loop's problem, not ours
	}
	for i := 0; i < n; i++ {
		raw := p.raw[i]
		var kind Kind
		switch raw.Filter {
		case syscall.EVFILT_READ:
			kind |= Readable
		case syscall.EVFILT_WRITE:
			kind |= Writable
		}
		// EV_EOF on either filter means the peer went away; report it as
		// readable so the handler's normal read path sees the close.
		if raw.Flags&syscall.EV_EOF != 0 {
			kind |= Readable
		}
		events[i] = Event{FD: int(raw.Ident), Kind: kind}
	}
	return n, nil
}

func (p *kqueuePoller) Close() error {
	if p.fd < 0 {
		return ErrClosed
	}
	err := syscall.Close(p.fd)
	p.fd = -1
	return err
}
