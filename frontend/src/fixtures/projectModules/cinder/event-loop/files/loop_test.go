package evloop

import (
	"syscall"
	"testing"
	"time"
)

// A socketpair is the cheapest way to get two connected descriptors without a
// network, which makes these tests fast and independent of the server package.
func socketPair(t *testing.T) (int, int) {
	t.Helper()
	fds, err := syscall.Socketpair(syscall.AF_UNIX, syscall.SOCK_STREAM, 0)
	if err != nil {
		t.Fatalf("socketpair: %v", err)
	}
	t.Cleanup(func() {
		_ = syscall.Close(fds[0])
		_ = syscall.Close(fds[1])
	})
	return fds[0], fds[1]
}

// chanHandler reports callbacks over channels so the test goroutine can observe
// them without touching loop state.
type chanHandler struct {
	readable chan int
	writable chan int
}

func newChanHandler() *chanHandler {
	return &chanHandler{
		readable: make(chan int, 16),
		writable: make(chan int, 16),
	}
}

func (h *chanHandler) OnReadable(fd int) error {
	select {
	case h.readable <- fd:
	default:
	}
	return nil
}

func (h *chanHandler) OnWritable(fd int) error {
	select {
	case h.writable <- fd:
	default:
	}
	return nil
}

// Register must switch the descriptor to non-blocking. Proof: a read on an
// empty socket returns EAGAIN instead of parking the caller forever.
func TestRegisterSetsNonBlocking(t *testing.T) {
	a, _ := socketPair(t)

	l, err := New(newChanHandler(), 8, 10)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	defer func() { _ = l.Close() }()

	if err := l.Register(a, Readable); err != nil {
		t.Fatalf("Register: %v", err)
	}

	buf := make([]byte, 1)
	_, err = syscall.Read(a, buf)
	if err != syscall.EAGAIN && err != syscall.EWOULDBLOCK {
		t.Fatalf("read on empty registered fd = %v, want EAGAIN", err)
	}
}

func TestLoopDispatchesReadable(t *testing.T) {
	a, b := socketPair(t)

	h := newChanHandler()
	l, err := New(h, 8, 10)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if err := l.Register(a, Readable); err != nil {
		t.Fatalf("Register: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- l.Run() }()

	if _, err := syscall.Write(b, []byte("ping")); err != nil {
		t.Fatalf("write: %v", err)
	}

	select {
	case fd := <-h.readable:
		if fd != a {
			t.Fatalf("readable fd = %d, want %d", fd, a)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("loop never reported the descriptor readable")
	}

	l.Stop()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after Stop")
	}
	_ = l.Close()
}

// Stop must be noticed within roughly one poll timeout, even with nothing
// happening. A loop that blocks forever in Wait fails here.
func TestLoopStopsPromptlyWhenIdle(t *testing.T) {
	l, err := New(newChanHandler(), 8, 50)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- l.Run() }()

	time.Sleep(20 * time.Millisecond)
	start := time.Now()
	l.Stop()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run: %v", err)
		}
		if elapsed := time.Since(start); elapsed > time.Second {
			t.Fatalf("Run took %v to notice Stop", elapsed)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after Stop")
	}
	_ = l.Close()
}

// Work posted from another goroutine must execute on the loop goroutine.
func TestPostRunsOnLoop(t *testing.T) {
	l, err := New(newChanHandler(), 8, 10)
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	done := make(chan error, 1)
	go func() { done <- l.Run() }()

	ran := make(chan struct{})
	l.Post(func() { close(ran) })

	select {
	case <-ran:
	case <-time.After(2 * time.Second):
		t.Fatal("posted task never ran")
	}

	l.Stop()
	<-done
	_ = l.Close()
}
