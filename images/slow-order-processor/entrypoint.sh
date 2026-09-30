#!/bin/sh
# Bind immediately; app returns 503 on /health until BOOT_DELAY_SECONDS elapses.
set -eu
exec gunicorn --bind 0.0.0.0:8000 --workers 1 --threads 2 app:app
