// LineSrv is a line-oriented TCP server: bind, accept, speak PING/ECHO/QUIT.
package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	cfg := FromEnv()
	log := NewLogger(cfg.LogLevel)

	// NotifyContext cancels ctx on the first SIGINT/SIGTERM. A second signal
	// restores the default handler, so an impatient operator can still kill us.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv := NewServer(cfg, log)
	if err := srv.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Errorf("server exited: %v", err)
		os.Exit(1)
	}

	log.Infof("shutdown complete")
}
