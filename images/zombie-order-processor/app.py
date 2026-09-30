"""QuickByte Order Processor — liveness zombie (tag 1.0).

Same HTTP surface as v1.2, but GET /health hangs on the first container
incarnation. An emptyDir marker at /var/run/zombie survives restart so the
next incarnation serves a healthy /health (kubelet liveness demo).
"""

from __future__ import annotations

import logging
import os
import time
import uuid

from flask import Flask, jsonify, request

APP_VERSION = os.environ.get("APP_VERSION", "1.0").strip() or "1.0"
ZOMBIE_MARKER_DIR = os.environ.get("ZOMBIE_MARKER_DIR", "/var/run/zombie").strip() or "/var/run/zombie"
ZOMBIE_MARKER_FILE = os.path.join(ZOMBIE_MARKER_DIR, "container-started")
# Long enough to beat probe timeoutSeconds (1) and the lab's urllib timeout (3),
# short enough not to wedge the worker for an hour after a manual check.
ZOMBIE_HANG_SECONDS = int(os.environ.get("ZOMBIE_HANG_SECONDS", "8"))

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("zombie-order-processor")

_zombie_hang_health = False


def _init_zombie() -> None:
    global _zombie_hang_health
    try:
        os.makedirs(ZOMBIE_MARKER_DIR, exist_ok=True)
    except OSError as exc:
        # Without a writable marker dir we cannot recover after restart — hang
        # anyway so the liveness lab still shows probe failures.
        _zombie_hang_health = True
        log.error("cannot create marker dir %s: %s — /health will hang", ZOMBIE_MARKER_DIR, exc)
        return
    if os.path.exists(ZOMBIE_MARKER_FILE):
        _zombie_hang_health = False
        log.warning("marker present — /health healthy (post-restart)")
        return
    try:
        with open(ZOMBIE_MARKER_FILE, "w", encoding="utf-8") as fh:
            fh.write("started\n")
    except OSError as exc:
        _zombie_hang_health = True
        log.error("cannot write marker: %s — /health will hang", exc)
        return
    _zombie_hang_health = True
    log.warning(
        "first incarnation — GET /health will hang ~%ss until liveness restarts this container",
        ZOMBIE_HANG_SECONDS,
    )


_init_zombie()


@app.get("/health")
def health():
    if _zombie_hang_health:
        log.warning("/health hung (simulating deadlock)")
        time.sleep(ZOMBIE_HANG_SECONDS)
        # Still fail closed if somehow the client waited out the sleep.
        return jsonify({"status": "zombie", "version": APP_VERSION}), 503
    return jsonify({"status": "ok", "version": APP_VERSION}), 200


@app.post("/orders")
def create_order():
    payload = request.get_json(silent=True) or {}
    order_id = f"ORD-{uuid.uuid4().hex[:8].upper()}"
    return jsonify({
        "order_id": order_id,
        "status": "created",
        "customer_id": payload.get("customer_id"),
        "items": payload.get("items") or [],
        "total": payload.get("total"),
        "version": APP_VERSION,
    }), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
