// Command cinder runs the key-value server.
//
// Compare this with module 1: the only change is that server.New can now fail,
// because it opens a poller. The concurrency model underneath changed
// completely and the process wiring did not — which is the point of keeping
// New/Run/Close as the entire surface.
package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"syscall"

	"github.com/devlabs/cinder/internal/config"
	"github.com/devlabs/cinder/internal/logx"
	"github.com/devlabs/cinder/internal/server"
)

func main() {
	cfg := config.FromEnv()
	log := logx.New(cfg.LogLevel)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	srv, err := server.New(cfg, log)
	if err != nil {
		log.Errorf("start: %v", err)
		os.Exit(1)
	}

	if err := srv.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Errorf("server exited: %v", err)
		os.Exit(1)
	}

	log.Infof("shutdown complete")
}
