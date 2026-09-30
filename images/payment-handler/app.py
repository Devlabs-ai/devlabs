"""QuickByte Payment Handler — Flask lab workload."""

from __future__ import annotations

import os
import uuid

from flask import Flask, jsonify, request

APP_VERSION = os.environ.get("APP_VERSION", "v1.0").strip() or "v1.0"

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify({"status": "ok", "version": APP_VERSION}), 200


@app.post("/pay")
def pay():
    payload = request.get_json(silent=True) or {}
    order_id = payload.get("order_id") or f"ORD-{uuid.uuid4().hex[:8].upper()}"
    amount = payload.get("amount")
    try:
        amount_n = float(amount) if amount is not None else 0.0
    except (TypeError, ValueError):
        amount_n = 0.0

    if amount_n < 0:
        return jsonify({"error": "invalid_amount", "version": APP_VERSION}), 400

    payment_id = f"PAY-{uuid.uuid4().hex[:8].upper()}"
    return jsonify({
        "payment_id": payment_id,
        "order_id": order_id,
        "status": "captured",
        "amount": amount_n,
        "version": APP_VERSION,
    }), 200


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
