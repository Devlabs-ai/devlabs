# ----------------------------------------------------------------------------
# Devlabs — dev convenience targets
#
# Common flow:
#   make install      # install backend + frontend npm deps
#   make infra-up     # start Postgres + Redis (docker compose, detached)
#   make dev          # start infra (if not already up), backend, and frontend
#                     # together with log prefixes; Ctrl-C stops everything
#
# Or run each tier in its own terminal:
#   make backend
#   make frontend
# ----------------------------------------------------------------------------

SHELL := /bin/bash

# Default `make` with no target prints help.
.DEFAULT_GOAL := help

.PHONY: help install infra-up infra-down infra-reset backend frontend dev stop \
        build clean reset seed-memory seed-memory-force seed-memory-dry

help:
	@printf "\nDevlabs — make targets\n\n"
	@printf "  %-14s %s\n" "install"     "install backend + frontend npm deps"
	@printf "  %-14s %s\n" "infra-up"    "start Postgres + Redis (detached)"
	@printf "  %-14s %s\n" "infra-down"  "stop Postgres + Redis (keep volumes)"
	@printf "  %-14s %s\n" "infra-reset" "stop + wipe Postgres/Redis volumes (DESTRUCTIVE)"
	@printf "  %-14s %s\n" "backend"     "run backend dev server (foreground, port 4000)"
	@printf "  %-14s %s\n" "frontend"    "run frontend dev server (foreground, port 5173)"
	@printf "  %-14s %s\n" "dev"         "infra + backend + frontend together; Ctrl-C stops all"
	@printf "  %-14s %s\n" "stop"        "kill any stray dev servers and stop infra"
	@printf "  %-14s %s\n" "build"       "production frontend build into frontend/dist/"
	@printf "  %-14s %s\n" "seed-memory" "pre-seed specialists table from the curated image catalog"
	@printf "  %-14s %s\n" "clean"       "remove node_modules, dist, ephemeral sandbox dirs"
	@printf "  %-14s %s\n" "reset"       "clean + infra-reset (full wipe)"
	@printf "\n"

# ---------------------------------------------------------------------------
# dependency install
# ---------------------------------------------------------------------------

install:
	@echo "==> installing backend deps"
	cd backend && npm install
	@echo "==> installing frontend deps"
	cd frontend && npm install

# ---------------------------------------------------------------------------
# infrastructure (Postgres + Redis via docker compose)
# ---------------------------------------------------------------------------

infra-up:
	@echo "==> starting Postgres + Redis (detached)"
	docker compose -f docker-compose.infra.yml up -d

infra-down:
	@echo "==> stopping Postgres + Redis"
	docker compose -f docker-compose.infra.yml down

infra-reset:
	@echo "==> wiping Postgres + Redis volumes (DESTRUCTIVE)"
	docker compose -f docker-compose.infra.yml down -v

# ---------------------------------------------------------------------------
# single-tier dev servers (foreground)
# ---------------------------------------------------------------------------

backend:
	cd backend && npm run dev

frontend:
	cd frontend && npm run dev

# ---------------------------------------------------------------------------
# all-in-one dev: infra detached + backend + frontend foreground
# ---------------------------------------------------------------------------
#
# Trap forwards Ctrl-C to both child processes so a single keystroke shuts
# everything down. Each tier's stdout/stderr is prefixed so logs are
# distinguishable in a single terminal.

dev: infra-up
	@echo "==> launching backend (4000) + frontend (5173); Ctrl-C to stop"
	@trap 'echo; echo "==> stopping dev servers..."; kill 0' INT TERM; \
	  ( cd backend  && npm run dev 2>&1 | awk '{ print "[be] " $$0; fflush() }' ) & \
	  ( cd frontend && npm run dev 2>&1 | awk '{ print "[fe] " $$0; fflush() }' ) & \
	  wait

# ---------------------------------------------------------------------------
# teardown helpers
# ---------------------------------------------------------------------------
#
# `pkill -f` is best-effort; ignore errors if no matching process exists.

stop:
	@echo "==> killing backend nodemon / server"
	-@pkill -f "nodemon .* server.js" 2>/dev/null || true
	-@pkill -f "node .*server.js"     2>/dev/null || true
	@echo "==> killing frontend vite"
	-@pkill -f "vite" 2>/dev/null || true
	@$(MAKE) -s infra-down

# ---------------------------------------------------------------------------
# build + clean
# ---------------------------------------------------------------------------

build:
	cd frontend && npm run build

# ---------------------------------------------------------------------------
# build_memory seeding
# ---------------------------------------------------------------------------
#
# Pre-populates the specialists table with ~32 curated image handbook rows
# (Postgres, Kafka, Nginx, Spark, ...). Idempotent: re-runs skip unchanged
# entries. Pass extra flags via
# ARGS=... (e.g. `make seed-memory ARGS="--category=postgres"`).

seed-memory:
	cd backend && node scripts/seedMemory.js $(ARGS)

seed-memory-force:
	cd backend && node scripts/seedMemory.js --force $(ARGS)

seed-memory-dry:
	cd backend && node scripts/seedMemory.js --dry-run $(ARGS)

clean:
	@echo "==> removing node_modules + build output"
	rm -rf backend/node_modules frontend/node_modules frontend/dist
	@echo "==> removing ephemeral sandbox dirs"
	find sandbox/builds   -mindepth 1 -maxdepth 1 ! -name '.gitkeep' -exec rm -rf {} + 2>/dev/null || true
	find sandbox/sessions -mindepth 1 -maxdepth 1 ! -name '.gitkeep' -exec rm -rf {} + 2>/dev/null || true

reset: clean infra-reset
