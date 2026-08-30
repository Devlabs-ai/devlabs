// Package config holds the knobs the server reads at startup.
//
// Resolved once, before anything is listening, then treated as read-only. That
// rule earns its keep in this module: the loop reads these fields on the hot
// path and never has to synchronise, because nothing writes them again.
package config

import (
	"os"
	"strconv"
	"time"
)

// Config is the full set of startup knobs. Keep it flat and boring.
type Config struct {
	// Addr is the listen address, e.g. ":7379".
	Addr string

	// Backlog is the accept queue depth passed to listen(2). When the loop is
	// busy, this is how many completed connections the kernel will hold before
	// new clients get refused.
	Backlog int

	// MaxEvents caps how many readiness notifications one poll returns. Larger
	// means fewer syscalls under load; too large means one batch monopolises
	// the loop while other work (timers, shutdown) waits.
	MaxEvents int

	// PollTimeoutMs bounds how long the loop blocks in the kernel. It is the
	// upper bound on shutdown latency and, from the expiry module onward, on
	// timer accuracy. Negative means block forever.
	PollTimeoutMs int

	// ReadBufBytes sizes the single scratch buffer every read borrows.
	ReadBufBytes int

	// MaxLineBytes caps one request. Delimiter framing without a cap is a
	// memory exhaustion bug: a client that never sends a newline grows the
	// connection buffer until the process dies.
	MaxLineBytes int

	// IdleTimeout is unused in this module and returns in the expiry module,
	// where the loop gains a timer wheel to enforce it without a goroutine.
	IdleTimeout time.Duration

	// LogLevel is one of debug, info, error.
	LogLevel string
}

// Default returns the configuration used when the environment says nothing.
func Default() Config {
	return Config{
		Addr:          ":7379",
		Backlog:       511, // Redis's default: one less than a power of two
		MaxEvents:     256,
		PollTimeoutMs: 100,
		ReadBufBytes:  64 * 1024,
		MaxLineBytes:  64 * 1024,
		IdleTimeout:   0,
		LogLevel:      "info",
	}
}

// FromEnv layers CINDER_* environment overrides on top of Default.
func FromEnv() Config {
	cfg := Default()
	cfg.Addr = envStr("CINDER_ADDR", cfg.Addr)
	cfg.Backlog = envInt("CINDER_BACKLOG", cfg.Backlog)
	cfg.MaxEvents = envInt("CINDER_MAX_EVENTS", cfg.MaxEvents)
	cfg.PollTimeoutMs = envInt("CINDER_POLL_TIMEOUT_MS", cfg.PollTimeoutMs)
	cfg.ReadBufBytes = envInt("CINDER_READ_BUF_BYTES", cfg.ReadBufBytes)
	cfg.MaxLineBytes = envInt("CINDER_MAX_LINE_BYTES", cfg.MaxLineBytes)
	cfg.LogLevel = envStr("CINDER_LOG_LEVEL", cfg.LogLevel)
	return cfg
}

func envStr(key, def string) string {
	if v, ok := os.LookupEnv(key); ok && v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return def
	}
	return n
}
