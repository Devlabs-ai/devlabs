//go:build linux

package evloop

import (
	"fmt"
	"syscall"
)

// epollPoller keeps the interest set inside the kernel, which is why epoll is
// O(ready) per call while select/poll are O(registered).
type epollPoller struct {
	fd  int
	raw []syscall.EpollEvent
}

func newPoller(maxEvents int) (Poller, error) {
	// EPOLL_CLOEXEC so an exec'd child does not inherit the epoll descriptor.
	fd, err := syscall.EpollCreate1(syscall.EPOLL_CLOEXEC)
	if err != nil {
		return nil, fmt.Errorf("epoll_create1: %w", err)
	}
	return &epollPoller{fd: fd, raw: make([]syscall.EpollEvent, maxEvents)}, nil
}

func epollMask(k Kind) uint32 {
	// Level triggered: no EPOLLET here. The kernel keeps reminding us while
	// data is unread, which forgives a handler that stops early.
	//
	// EPOLLRDHUP tells us the peer closed its write side, so we can tear the
	// connection down instead of waiting for a read to return 0.
	mask := uint32(syscall.EPOLLRDHUP)
	if k.Has(Readable) {
		mask |= syscall.EPOLLIN
	}
	if k.Has(Writable) {
		mask |= syscall.EPOLLOUT
	}
	return mask
}

func (p *epollPoller) ctl(op, fd int, interest Kind) error {
	ev := syscall.EpollEvent{Events: epollMask(interest), Fd: int32(fd)}
	if err := syscall.EpollCtl(p.fd, op, fd, &ev); err != nil {
		return fmt.Errorf("epoll_ctl(fd=%d): %w", fd, err)
	}
	return nil
}

func (p *epollPoller) Add(fd int, interest Kind) error {
	return p.ctl(syscall.EPOLL_CTL_ADD, fd, interest)
}

func (p *epollPoller) Modify(fd int, interest Kind) error {
	return p.ctl(syscall.EPOLL_CTL_MOD, fd, interest)
}

func (p *epollPoller) Remove(fd int) error {
	// Closing a descriptor removes it from the interest set automatically, so
	// ENOENT here is expected and harmless.
	if err := syscall.EpollCtl(p.fd, syscall.EPOLL_CTL_DEL, fd, nil); err != nil &&
		err != syscall.ENOENT && err != syscall.EBADF {
		return fmt.Errorf("epoll_ctl(del fd=%d): %w", fd, err)
	}
	return nil
}

func (p *epollPoller) Wait(events []Event, timeoutMs int) (int, error) {
	max := len(events)
	if max > len(p.raw) {
		max = len(p.raw)
	}
	n, err := syscall.EpollWait(p.fd, p.raw[:max], timeoutMs)
	if err != nil {
		return 0, err // the loop is responsible for retrying EINTR
	}
	for i := 0; i < n; i++ {
		raw := p.raw[i]
		var kind Kind
		// Errors and hangups are reported as readable on purpose: the handler
		// reads, gets 0 or an error, and takes the single close path.
		if raw.Events&(syscall.EPOLLIN|syscall.EPOLLHUP|syscall.EPOLLRDHUP|syscall.EPOLLERR) != 0 {
			kind |= Readable
		}
		if raw.Events&syscall.EPOLLOUT != 0 {
			kind |= Writable
		}
		events[i] = Event{FD: int(raw.Fd), Kind: kind}
	}
	return n, nil
}

func (p *epollPoller) Close() error {
	if p.fd < 0 {
		return ErrClosed
	}
	err := syscall.Close(p.fd)
	p.fd = -1
	return err
}
