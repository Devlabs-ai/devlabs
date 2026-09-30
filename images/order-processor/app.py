"""QuickByte Order Processor — Flask lab workload (v1.0 / v1.1 / v1.2)."""

from __future__ import annotations

import logging
import os
import uuid

from flask import Flask, jsonify, request

APP_VERSION = os.environ.get("APP_VERSION", "v1.0").strip() or "v1.0"

app = Flask(__name__)


def _configure_logging() -> None:
    level_name = os.environ.get("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(level=level, format="%(levelname)s %(message)s")


_configure_logging()
log = logging.getLogger("order-processor")


def _min_order_value() -> float:
    # v1.0 story: baked-in reject under 50 (the bug fixed in v1.1).
    if APP_VERSION == "v1.0":
        return 50.0
    # v1.1+: accept small orders by default; v1.2 also honors ConfigMap env.
    raw = os.environ.get("MIN_ORDER_VALUE", "0")
    try:
        return float(raw)
    except ValueError:
        return 0.0


def _max_items() -> int:
    raw = os.environ.get("MAX_ITEMS_PER_ORDER", "100")
    try:
        return int(raw)
    except ValueError:
        return 100


@app.get("/health")
def health():
    return jsonify({"status": "ok", "version": APP_VERSION}), 200


@app.post("/orders")
def create_order():
    payload = request.get_json(silent=True) or {}
    items = payload.get("items") or []
    total = payload.get("total")
    try:
        total_n = float(total) if total is not None else 0.0
    except (TypeError, ValueError):
        total_n = 0.0

    min_val = _min_order_value()
    if total_n < min_val:
        log.warning("reject order total=%s min=%s version=%s", total_n, min_val, APP_VERSION)
        return jsonify({
            "error": "order_total_too_low",
            "min_order_value": min_val,
            "version": APP_VERSION,
        }), 400

    if APP_VERSION >= "v1.2" and isinstance(items, list) and len(items) > _max_items():
        return jsonify({
            "error": "too_many_items",
            "max_items_per_order": _max_items(),
            "version": APP_VERSION,
        }), 400

    order_id = f"ORD-{uuid.uuid4().hex[:8].upper()}"
    body = {
        "order_id": order_id,
        "status": "created",
        "customer_id": payload.get("customer_id"),
        "items": items,
        "total": payload.get("total"),
        "version": APP_VERSION,
    }
    # v1.2 labs inject PAYMENT_API_KEY via Secret — echo presence only, never the value.
    if APP_VERSION >= "v1.2":
        body["payment_configured"] = bool(os.environ.get("PAYMENT_API_KEY"))
    log.info("created %s version=%s", order_id, APP_VERSION)
    return jsonify(body), 201


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
