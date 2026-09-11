package eventloop

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
)

// Handler receives readiness callbacks from the loop.
//
// Every method runs on the loop's own goroutine, one at a time. That is the
// contract the rest of the store is built on: the keyspace never locks because
// it is only ever touched from here. A non-nil error means that fd's work
// failed; the loop continues with the next event and does not exit.
//
// OnWritable is part of the contract so write-interest arming can land later
// without reshaping the loop. Chapter 1 production interest is Readable-first;
// socketpair tests may still register Writable on purpose.
type Handler interface {
	OnReadable(fd int) error
	OnWritable(fd int) error
}

// Loop owns a Poller and turns readiness notifications into Handler calls.
//
// Accept, framing, and commands live outside this type — later chapters.
type Loop struct {
	poller    Poller
	handler   Handler
	events    []Event
	timeoutMs int

	stopped atomic.Bool

	mu    sync.Mutex
	tasks []func()
}

// New builds a Loop that drives h.
//
// maxEvents caps how many readiness events one Wait may return (default 128).
// timeoutMs is how long Wait may block. A value < 0 waits forever. A small
// positive timeout is how Stop and Post get noticed without a wakeup descriptor.
func New(h Handler, maxEvents, timeoutMs int) (*Loop, error) {
	if h == nil {
		return nil, fmt.Errorf("evloop: nil handler")
	}
	if maxEvents <= 0 {
		maxEvents = 128
	}
	p, err := NewPoller(maxEvents)
	if err != nil {
		return nil, err
	}
	return &Loop{
		poller:    p,
		handler:   h,
		events:    make([]Event, maxEvents),
		timeoutMs: timeoutMs,
	}, nil
}

// Register puts fd under the loop's control.
func (l *Loop) Register(fd int, interest Kind) error {
	// ── TODO(1.1) — non-blocking, then watch ─────────────────────────────────
	//
	// 1. syscall.SetNonblock(fd, true) — readiness can be stale; a blocking
	//    read on a "ready" fd freezes every client.
	// 2. l.poller.Add(fd, interest)
	//
	// Wrap errors with fmt.Errorf so tests and logs show which step failed.
	panic("TODO(1.1): Register — set nonblock, then poller.Add")
}

// Modify changes which readiness events the loop watches for fd.
//
// fd must already be registered. Used later to arm/disarm Writable while an
// out buffer has pending bytes.
func (l *Loop) Modify(fd int, interest Kind) error {
	if err := l.poller.Modify(fd, interest); err != nil {
		return fmt.Errorf("evloop: modify fd=%d: %w", fd, err)
	}
	return nil
}

// Deregister stops watching fd. Safe if fd was never registered.
func (l *Loop) Deregister(fd int) error {
	return l.poller.Remove(fd)
}

// Run drives the loop until Stop is called.
func (l *Loop) Run() error {
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// ── TODO(1.2) — the readiness loop ───────────────────────────────────────
	//
	// for !l.stopped.Load() {
	//   l.drainTasks()
	//   n, err := l.poller.Wait(l.events, l.timeoutMs)
	//   - err == syscall.EINTR → continue
	//   - other err → if stopped, return nil; else return wrapped err
	//   - n == 0 → continue (timeout)
	//   for each event in events[:n]:
	//     if Writable → handler.OnWritable (ignore error, next event)
	//     if Readable → handler.OnReadable (ignore error, next event)
	// }
	// l.drainTasks()
	// return nil
	//
	// Writable before Readable keeps future write-flush ordering stable.
	_ = syscall.EINTR
	panic("TODO(1.2): Run — Wait, dispatch, survive EINTR, stop cleanly")
}

// Post queues fn to run on the loop goroutine before the next Wait.
func (l *Loop) Post(fn func()) {
	if fn == nil {
		return
	}
	l.mu.Lock()
	l.tasks = append(l.tasks, fn)
	l.mu.Unlock()
}

func (l *Loop) drainTasks() {
	l.mu.Lock()
	pending := l.tasks
	l.tasks = nil
	l.mu.Unlock()

	for _, fn := range pending {
		fn()
	}
}

// Stop asks the loop to exit. Safe from another goroutine.
func (l *Loop) Stop() {
	l.stopped.Store(true)
}

// Stopped reports whether Stop has been called.
func (l *Loop) Stopped() bool { return l.stopped.Load() }

// Close releases the poller. Call only after Run has returned.
func (l *Loop) Close() error {
	if l.poller == nil {
		return nil
	}
	err := l.poller.Close()
	l.poller = nil
	return err
}
