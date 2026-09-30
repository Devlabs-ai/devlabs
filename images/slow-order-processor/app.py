"""QuickByte Order Processor — slow boot (tag 1.0) for startup-probe labs.

Listens immediately, but GET /health returns 503 until BOOT_DELAY_SECONDS
(default 25) have elapsed. Aggressive liveness without a startup probe →
CrashLoopBackOff; with a startup probe, warmup is allowed to finish.
"""

from __future__ import annotations

import logging
import os
import time
import uuid

from flask import Flask, jsonify, request

APP_VERSION = os.environ.get("APP_VERSION", "1.0").strip() or "1.0"
BOOT_DELAY_SECONDS = max(0, int(os.environ.get("BOOT_DELAY_SECONDS", "25")))
_STARTED_AT = time.monotonic()

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
log = logging.getLogger("slow-order-processor")
log.warning(
    "slow-order-processor: /health returns 503 for first %ss (startup-probe lab)",
    BOOT_DELAY_SECONDS,
)


def _still_warming() -> bool:
    return (time.monotonic() - _STARTED_AT) < BOOT_DELAY_SECONDS


@app.get("/health")
def health():
    if _still_warming():
        remaining = max(0.0, BOOT_DELAY_SECONDS - (time.monotonic() - _STARTED_AT))
        return jsonify({
            "status": "starting",
            "version": APP_VERSION,
            "warmup_remaining_sec": round(remaining, 1),
        }), 503
    return jsonify({"status": "ok", "version": APP_VERSION}), 200


@app.post("/orders")
def create_order():
    if _still_warming():
        return jsonify({"error": "warming_up", "version": APP_VERSION}), 503
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
