package main

import (
	"os"
	"strconv"
	"time"
)

// Config is the full set of startup knobs. Keep it flat and boring.
type Config struct {
	// Addr is the listen address passed to net.Listen, e.g. ":7400".
	Addr string

	// IdleTimeout closes a connection that has sent nothing for this long.
	// Without it, a peer that vanishes without a FIN pins a descriptor forever.
	IdleTimeout time.Duration

	// MaxLineBytes caps a single request line. Delimiter framing without a cap
	// is a memory exhaustion bug: a client that never sends \n grows the buffer
	// until the process dies.
	MaxLineBytes int

	// LogLevel is one of debug, info, error.
	LogLevel string
}

// Default returns the configuration used when the environment says nothing.
func Default() Config {
	return Config{
		Addr:         ":7400",
		IdleTimeout:  5 * time.Minute,
		MaxLineBytes: 64 * 1024,
		LogLevel:     "info",
	}
}

// FromEnv layers LINESRV_* environment overrides on top of Default.
func FromEnv() Config {
	cfg := Default()
	cfg.Addr = envStr("LINESRV_ADDR", cfg.Addr)
	cfg.IdleTimeout = envDur("LINESRV_IDLE_TIMEOUT", cfg.IdleTimeout)
	cfg.MaxLineBytes = envInt("LINESRV_MAX_LINE_BYTES", cfg.MaxLineBytes)
	cfg.LogLevel = envStr("LINESRV_LOG_LEVEL", cfg.LogLevel)
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

func envDur(key string, def time.Duration) time.Duration {
	v, ok := os.LookupEnv(key)
	if !ok || v == "" {
		return def
	}
	d, err := time.ParseDuration(v)
	if err != nil || d < 0 {
		return def
	}
	return d
}
