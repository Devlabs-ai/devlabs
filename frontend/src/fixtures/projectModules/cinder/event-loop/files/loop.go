package evloop

import (
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"syscall"
)

// Handler receives readiness callbacks.
//
// Every method runs on the loop's own goroutine, one at a time. That single
// sentence is the contract the rest of Cinder is built on: the storage engine
// never locks because it is only ever touched from here.
type Handler interface {
	OnReadable(fd int) error
	OnWritable(fd int) error
}

// Loop owns a poller and turns readiness notifications into handler calls.
type Loop struct {
	poller    Poller
	handler   Handler
	events    []Event
	timeoutMs int

	stopped atomic.Bool

	// tasks is how other goroutines get work onto the loop thread — shutdown
	// requests today, background expiry in a later module. A production loop
	// would also poke a self-pipe (or eventfd) so Wait returns immediately;
	// Cinder settles for a bounded poll timeout, which costs a little latency
	// on the wake path and saves a descriptor plus a pile of code.
	mu    sync.Mutex
	tasks []func()
}

// New builds a loop that reports at most maxEvents readiness events per
// iteration and blocks at most timeoutMs in the kernel.
func New(h Handler, maxEvents, timeoutMs int) (*Loop, error) {
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

// Register adds a descriptor to the loop.
func (l *Loop) Register(fd int, interest Kind) error {
	// ── TODO(2.1) — put the fd under the loop's control ──────────────────────
	//
	// Two steps, and the order matters:
	//
	//   1. syscall.SetNonblock(fd, true). Without this, a read the kernel told
	//      you was ready can still block — stale readiness is real — and one
	//      blocked read freezes every client, because there is only one thread.
	//
	//   2. l.poller.Add(fd, interest).
	//
	// Wrap failures with the fd number; a bare EBADF from three layers down is
	// miserable to debug.
	//
	// Done when: TestLoopEchoesOverSocket gets past registration.
	panic("TODO(2.1): set the fd non-blocking and add it to the poller")
}

// Modify changes the interest set for a descriptor already registered.
//
// This is what arms and disarms write interest as a connection's out buffer
// fills and drains.
func (l *Loop) Modify(fd int, interest Kind) error {
	if err := l.poller.Modify(fd, interest); err != nil {
		return fmt.Errorf("evloop: modify fd=%d: %w", fd, err)
	}
	return nil
}

// Deregister drops a descriptor. Safe to call on an fd that is already gone.
func (l *Loop) Deregister(fd int) error {
	return l.poller.Remove(fd)
}

// Run drives the loop until Stop is called. It blocks the calling goroutine.
func (l *Loop) Run() error {
	// Pin this goroutine to one OS thread. The loop is single threaded by
	// design, and pinning keeps the Go scheduler from migrating it across
	// cores, which would throw away the cache locality that makes this model
	// fast in the first place.
	runtime.LockOSThread()
	defer runtime.UnlockOSThread()

	// ── TODO(2.2) — the event loop ───────────────────────────────────────────
	//
	// Until l.stopped.Load() is true:
	//
	//   1. l.drainTasks() — run anything other goroutines queued for us.
	//
	//   2. n, err := l.poller.Wait(l.events, l.timeoutMs)
	//        - err == syscall.EINTR: a signal interrupted the call. This is
	//          normal, not fatal. continue.
	//        - any other error: return it.
	//        - n == 0: the timeout expired with nothing ready. continue, which
	//          is also how Stop eventually gets noticed.
	//
	//   3. For each of the first n events:
	//        - if ev.Kind.Has(Writable), call l.handler.OnWritable(ev.FD)
	//        - if ev.Kind.Has(Readable), call l.handler.OnReadable(ev.FD)
	//
	//      Flush before reading. Draining the out buffer first frees socket
	//      space for the replies the read is about to generate, and it gets
	//      bytes moving to a client that has been waiting.
	//
	//      A handler error means that connection is finished, not that the
	//      server is. The handler already closed it — log at debug and carry
	//      on with the next event. Killing the loop because one client sent
	//      something odd would be a denial of service you built yourself.
	//
	// Return nil on a clean stop.
	//
	// Done when: every test in server_test.go passes, and the process sits at
	// ~0% CPU with no clients connected.
	panic("TODO(2.2): implement the event loop")
}

// Post queues fn to run on the loop goroutine before the next Wait.
//
// Anything that touches connection or engine state from another goroutine must
// go through here. That is the whole discipline: state has one owner.
func (l *Loop) Post(fn func()) {
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

// Stop asks the loop to exit. It returns immediately; Run returns within one
// poll timeout.
func (l *Loop) Stop() {
	l.stopped.Store(true)
}

// Stopped reports whether Stop has been called.
func (l *Loop) Stopped() bool { return l.stopped.Load() }

// Close releases the poller. Call it after Run has returned.
func (l *Loop) Close() error {
	return l.poller.Close()
}

// IsEINTR keeps the EINTR check readable at the call site in Run.
func IsEINTR(err error) bool { return err == syscall.EINTR }
