// Command cinder runs a tiny TCP server driven by the chapter-1 event loop.
//
// Wire format is a toy CRLF line protocol (PING / ECHO / QUIT). CSP arrives in
// a later chapter. Accept, read, and reply live in internal/server; this file
// only wires config, signals, and Start/Close.
package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/devlabs/cinder/internal/server"
)

func main() {
	addr := envOr("CINDER_ADDR", "127.0.0.1:7379")

	srv, err := server.New(addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "server: %v\n", err)
		os.Exit(1)
	}

	// Ctrl-C → stop the loop; Start returns; then Close.
	sigc := make(chan os.Signal, 1)
	signal.Notify(sigc, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigc
		srv.Shutdown()
	}()

	if err := srv.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "start: %v\n", err)
		_ = srv.Close()
		os.Exit(1)
	}
	if err := srv.Close(); err != nil {
		fmt.Fprintf(os.Stderr, "close: %v\n", err)
		os.Exit(1)
	}
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
